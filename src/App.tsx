/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Card, Action, createShoe, shuffleDeck, calculateHandValue, isPair, isBlackjack,
  getOptimalAction, playDealer, RESHUFFLE_AT,
} from './gameLogic';
// グラフは依存ゼロの自作SVG/バーで描画（確実な描画・軽量化のためRecharts不使用）

type Phase = 'home' | 'tutorial' | 'playing' | 'dealing' | 'result' | 'dashboard';
type Result = 'W' | 'L' | 'P' | 'BJ';

interface PlayerHand {
  cards: Card[];
  bet: number;
  done: boolean;
  doubled: boolean;
  isSplitAces?: boolean;
  result?: Result;
}
interface Decision {
  handIndex: number;
  total: number;
  soft: boolean;
  dealerUp: string;
  chosen: Action;
  optimal: Action;
  correct: boolean;
  reason: string;
}
interface RoundRecord {
  ts: number;
  decisions: { chosen: Action; optimal: Action; correct: boolean }[];
  results: Result[];
  net: number;
}
interface SaveData {
  bankroll: number;
  history: RoundRecord[];
  tacticMode: boolean;
}

const BET = 100;
const START_BANKROLL = 10000;
const STORAGE_KEY = 'bj-academy:v1';

const ACTION_JA: Record<Action, string> = { HIT: 'ヒット', STAND: 'スタンド', DOUBLE: 'ダブル', SPLIT: 'スプリット' };
const RESULT_JA: Record<Result, string> = { W: '勝ち', L: '負け', P: '引き分け', BJ: 'ブラックジャック！' };

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        bankroll: typeof s.bankroll === 'number' ? s.bankroll : START_BANKROLL,
        history: Array.isArray(s.history) ? s.history : [],
        tacticMode: s.tacticMode !== false,
      };
    }
  } catch { /* ignore */ }
  return { bankroll: START_BANKROLL, history: [], tacticMode: true };
}
function persist(s: SaveData) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export default function App() {
  const initial = useMemo(loadSave, []);
  const [phase, setPhase] = useState<Phase>('home');
  const [shoe, setShoe] = useState<Card[]>(() => shuffleDeck(createShoe()));
  const [hands, setHands] = useState<PlayerHand[]>([]);
  const [dealer, setDealer] = useState<Card[]>([]);
  const [active, setActive] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [feedback, setFeedback] = useState<Decision | null>(null);
  const [reveal, setReveal] = useState(false);
  const [lastNet, setLastNet] = useState(0);

  const [bankroll, setBankroll] = useState(initial.bankroll);
  const [history, setHistory] = useState<RoundRecord[]>(initial.history);
  const [tacticMode, setTacticMode] = useState(initial.tacticMode);
  const [returnPhase, setReturnPhase] = useState<Phase>('home');

  const decisionsRef = useRef<Decision[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizeRef = useRef<(() => void) | null>(null);
  const openDashboard = () => { finalizeRef.current?.(); setReturnPhase(phase === 'dealing' ? 'result' : phase); setPhase('dashboard'); };
  const goHome = () => { finalizeRef.current?.(); setPhase('home'); };

  useEffect(() => { persist({ bankroll, history, tacticMode }); }, [bankroll, history, tacticMode]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // ── 統計（履歴から算出） ──
  const stats = useMemo(() => {
    const allDec = history.flatMap(r => r.decisions);
    const totalDec = allDec.length;
    const correctDec = allDec.filter(d => d.correct).length;
    const accuracy = totalDec ? (correctDec / totalDec) * 100 : 0;
    const allRes = history.flatMap(r => r.results);
    const totalHands = allRes.length;
    const wins = allRes.filter(r => r === 'W' || r === 'BJ').length;
    const losses = allRes.filter(r => r === 'L').length;
    const pushes = allRes.filter(r => r === 'P').length;
    const winRate = totalHands ? (wins / totalHands) * 100 : 0;
    // 累計正答率の推移
    let cc = 0, ct = 0;
    const trend = history.map((r, i) => {
      cc += r.decisions.filter(d => d.correct).length;
      ct += r.decisions.length;
      return { round: i + 1, accuracy: ct ? Math.round((cc / ct) * 100) : 0 };
    });
    // アクション別正答率（最適手ごと）
    const byAction = (['HIT', 'STAND', 'DOUBLE', 'SPLIT'] as Action[]).map(a => {
      const subset = allDec.filter(d => d.optimal === a);
      const c = subset.filter(d => d.correct).length;
      return { action: ACTION_JA[a], rate: subset.length ? Math.round((c / subset.length) * 100) : 0, count: subset.length };
    });
    const recent = allDec.slice(-20);
    const recentAcc = recent.length ? Math.round((recent.filter(d => d.correct).length / recent.length) * 100) : 0;
    return { totalDec, correctDec, accuracy, totalHands, wins, losses, pushes, winRate, trend, byAction, recentAcc, rounds: history.length };
  }, [history]);

  // ── ラウンド開始 ──
  const startRound = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    finalizeRef.current = null;
    let s = shoe.length < RESHUFFLE_AT ? shuffleDeck(createShoe()) : [...shoe];
    const p1 = s.pop()!, d1 = s.pop()!, p2 = s.pop()!, d2 = s.pop()!;
    const ph: PlayerHand = { cards: [p1, p2], bet: BET, done: false, doubled: false };
    const dh = [d1, d2];
    decisionsRef.current = [];
    setDecisions([]);
    setFeedback(null);
    setReveal(false);
    setActive(0);
    setShoe(s);
    setDealer(dh);

    const pBJ = isBlackjack(ph.cards);
    const dBJ = isBlackjack(dh);
    if (pBJ || dBJ) {
      let result: Result; let net = 0;
      if (pBJ && dBJ) { result = 'P'; }
      else if (pBJ) { result = 'BJ'; net = Math.round(BET * 1.5); }
      else { result = 'L'; net = -BET; }
      setHands([{ ...ph, done: true, result }]);
      setReveal(true);
      setBankroll(b => b + net);
      setLastNet(net);
      setHistory(prev => [...prev, { ts: Date.now(), decisions: [], results: [result], net }]);
      setPhase('result');
      return;
    }
    setHands([ph]);
    setPhase('playing');
  };

  const canDoubleNow = (h: PlayerHand) => h.cards.length === 2;
  const canSplitNow = (h: PlayerHand) => isPair(h.cards) && hands.length < 2;

  const record = (handCards: Card[], chosen: Action): Decision => {
    const canDbl = handCards.length === 2;
    const canSpl = isPair(handCards) && hands.length < 2;
    const opt = getOptimalAction(handCards, dealer[0], canDbl, canSpl);
    const hv = calculateHandValue(handCards);
    const dec: Decision = {
      handIndex: active, total: hv.value, soft: hv.isSoft, dealerUp: dealer[0].rank,
      chosen, optimal: opt.action, correct: chosen === opt.action, reason: opt.reason,
    };
    decisionsRef.current.push(dec);
    setDecisions([...decisionsRef.current]);
    setFeedback(dec);
    return dec;
  };

  const resolveRound = (finalHands: PlayerHand[], s: Card[]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setReveal(true);
    const allBust = finalHands.every(h => calculateHandValue(h.cards).value > 21);
    let dFinal = dealer; let deck = s;
    if (!allBust) {
      const r = playDealer(dealer, s);
      dFinal = r.hand; deck = r.shoe;
    }
    const extra = dFinal.slice(dealer.length); // ディーラーが引くカード（1枚ずつ見せる演出用）

    let settled = false;
    const finalize = () => {
      if (settled) return; // 二重清算防止（演出完了 or 画面遷移のどちらか一方で確定）
      settled = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      const dVal = calculateHandValue(dFinal).value;
      let net = 0;
      const results: Result[] = [];
      const resolved = finalHands.map(h => {
        const pVal = calculateHandValue(h.cards).value;
        let result: Result;
        if (pVal > 21) { result = 'L'; net -= h.bet; }
        else if (dVal > 21 || pVal > dVal) { result = 'W'; net += h.bet; }
        else if (pVal === dVal) { result = 'P'; }
        else { result = 'L'; net -= h.bet; }
        results.push(result);
        return { ...h, result };
      });
      setHands(resolved);
      setDealer(dFinal);
      setShoe(deck);
      setBankroll(b => b + net);
      setLastNet(net);
      setHistory(prev => [...prev, {
        ts: Date.now(),
        decisions: decisionsRef.current.map(d => ({ chosen: d.chosen, optimal: d.optimal, correct: d.correct })),
        results, net,
      }]);
      finalizeRef.current = null;
      setPhase(p => (p === 'dealing' ? 'result' : p));
    };
    finalizeRef.current = finalize; // 演出中に画面遷移されたら即清算できるよう公開

    // ディーラーの手番を1枚ずつ見せてから結果へ（「即リザルト」を避け、手札を確認できるように）
    setPhase('dealing');
    if (extra.length === 0) {
      timerRef.current = setTimeout(finalize, 850);
      return;
    }
    let i = 0;
    const drawNext = () => {
      const card = extra[i]; // 値を先に確定（setStateの遅延評価でindexがずれてundefinedになるのを防ぐ）
      i += 1;
      setDealer(d => [...d, card]);
      timerRef.current = setTimeout(i < extra.length ? drawNext : finalize, 650);
    };
    timerRef.current = setTimeout(drawNext, 650);
  };

  const advance = (updated: PlayerHand[], s: Card[]) => {
    const next = updated.findIndex(h => !h.done);
    if (next === -1) { resolveRound(updated, s); }
    else { setActive(next); setFeedback(null); }
  };

  const onAction = (action: Action) => {
    if (phase !== 'playing') return;
    const h = hands[active];
    if (!h || h.done) return;
    if (action === 'DOUBLE' && !canDoubleNow(h)) return;
    if (action === 'SPLIT' && !canSplitNow(h)) return;

    record(h.cards, action);
    const s = [...shoe];

    if (action === 'HIT') {
      const newCards = [...h.cards, s.pop()!];
      const v = calculateHandValue(newCards).value;
      const updated = [...hands];
      updated[active] = { ...h, cards: newCards, done: v >= 21 };
      setHands(updated); setShoe(s);
      if (v >= 21) advance(updated, s);
    } else if (action === 'STAND') {
      const updated = [...hands];
      updated[active] = { ...h, done: true };
      setHands(updated); setShoe(s);
      advance(updated, s);
    } else if (action === 'DOUBLE') {
      const newCards = [...h.cards, s.pop()!];
      const updated = [...hands];
      updated[active] = { ...h, cards: newCards, bet: h.bet * 2, doubled: true, done: true };
      setHands(updated); setShoe(s);
      advance(updated, s);
    } else if (action === 'SPLIT') {
      const aces = h.cards[0].rank === 'A';
      const h1: PlayerHand = { cards: [h.cards[0], s.pop()!], bet: h.bet, done: false, doubled: false, isSplitAces: aces };
      const h2: PlayerHand = { cards: [h.cards[1], s.pop()!], bet: h.bet, done: false, doubled: false, isSplitAces: aces };
      if (aces) { h1.done = true; h2.done = true; }
      if (calculateHandValue(h1.cards).value >= 21) h1.done = true;
      if (calculateHandValue(h2.cards).value >= 21) h2.done = true;
      const updated = [h1, h2];
      setHands(updated); setShoe(s); setFeedback(null);
      const next = updated.findIndex(hh => !hh.done);
      if (next === -1) advance(updated, s);
      else setActive(next);
    }
  };

  const resetData = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    finalizeRef.current = null; // 演出中の保留清算をキャンセル（リセットを上書きさせない）
    setHistory([]); setBankroll(START_BANKROLL);
    decisionsRef.current = [];
    setPhase('home'); setHands([]); setDealer([]); setFeedback(null);
  };

  // 現在アクティブハンドの推奨手（ヒント用）
  const hint = useMemo(() => {
    if (phase !== 'playing' || !hands[active] || !dealer[0]) return null;
    const h = hands[active];
    return getOptimalAction(h.cards, dealer[0], canDoubleNow(h), canSplitNow(h));
  }, [phase, hands, active, dealer]); // eslint-disable-line

  const dealerShown = reveal ? calculateHandValue(dealer).value : (dealer[0] ? dealer[0].value : 0);

  // ─────────── レンダリング ───────────
  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      <Header bankroll={bankroll} accuracy={stats.accuracy} onDashboard={openDashboard} onHome={goHome} />

      <main className="flex-1 flex flex-col items-center w-full max-w-3xl mx-auto px-4 py-6 gap-6">
        {/* テーブル */}
        <Table dealer={dealer} reveal={reveal} dealerShown={dealerShown} hands={hands} active={active} phase={phase} />

        {/* フィードバック / ヒント */}
        {phase === 'playing' && (
          <div className="w-full space-y-3">
            {tacticMode && hands[active] && !hands[active].done && hint && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/30 px-4 py-3 text-sm">
                <span className="text-[10px] uppercase tracking-widest text-indigo-300/80">初心者ヒント（推奨アクション）</span>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-bold text-indigo-300 text-base">{ACTION_JA[hint.action]}</span>
                  <span className="text-zinc-400 text-xs">{hint.reason}</span>
                </div>
              </div>
            )}
            {feedback && (
              <div className={`rounded-xl border px-4 py-3 text-sm ${feedback.correct ? 'border-emerald-500/40 bg-emerald-950/30' : 'border-rose-500/40 bg-rose-950/30'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold ${feedback.correct ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {feedback.correct ? '✓ 最適な選択！' : '✗ 最適ではありません'}
                  </span>
                  {!feedback.correct && (
                    <span className="text-[11px] text-zinc-400">
                      あなた: <b className="text-zinc-200">{ACTION_JA[feedback.chosen]}</b> / 最適: <b className="text-indigo-300">{ACTION_JA[feedback.optimal]}</b>
                    </span>
                  )}
                </div>
                <p className="text-[12px] leading-relaxed text-zinc-300">{feedback.reason}</p>
              </div>
            )}
          </div>
        )}

        {/* コントロール */}
        {phase === 'playing' && hands[active] && !hands[active].done && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
            <Ctrl label="ヒット" sub="HIT" onClick={() => onAction('HIT')} accent />
            <Ctrl label="スタンド" sub="STAND" onClick={() => onAction('STAND')} />
            <Ctrl label="ダブル" sub="DOUBLE" onClick={() => onAction('DOUBLE')} disabled={!canDoubleNow(hands[active])} />
            <Ctrl label="スプリット" sub="SPLIT" onClick={() => onAction('SPLIT')} disabled={!canSplitNow(hands[active])} />
          </div>
        )}

        {/* ディーラーの手番演出（即リザルトを避け、手札をしっかり見せる） */}
        {phase === 'dealing' && (
          <div className="w-full text-center text-sm font-bold py-3 animate-pulse">
            {hands.length > 0 && hands.every(h => calculateHandValue(h.cards).value > 21)
              ? <span className="text-rose-300/90">💥 バスト… 結果を確認中</span>
              : <span className="text-emerald-300/90">🎴 ディーラーの手番です…</span>}
          </div>
        )}

        {/* 結果（インライン：テーブルを隠さずに最終手札を確認できる） */}
        {phase === 'result' && (
          <ResultView hands={hands} dealer={dealer} decisions={decisions} net={lastNet} onNext={startRound} onDashboard={openDashboard} />
        )}
      </main>

      {/* フッター統計 */}
      <Footer stats={stats} tacticMode={tacticMode} onToggle={() => setTacticMode(v => !v)} onDashboard={openDashboard} />

      {/* オーバーレイ群 */}
      {phase === 'home' && <Home onStartTutorial={() => setPhase('tutorial')} onSkip={startRound} hasHistory={stats.rounds > 0} onDashboard={openDashboard} />}
      {phase === 'tutorial' && <Tutorial onDone={startRound} onSkip={startRound} />}
      {phase === 'dashboard' && <Dashboard stats={stats} bankroll={bankroll} onClose={() => setPhase(returnPhase)} onReset={resetData} />}
    </div>
  );
}

// ── Header ──
function Header({ bankroll, accuracy, onDashboard, onHome }: { bankroll: number; accuracy: number; onDashboard: () => void; onHome: () => void }) {
  return (
    <header className="h-14 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur flex items-center justify-between px-4 shrink-0">
      <button onClick={onHome} className="flex items-center gap-2 cursor-pointer">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-indigo-600 flex items-center justify-center font-black text-white text-xs">BJ</div>
        <div className="text-left leading-tight">
          <h1 className="text-sm font-bold tracking-tight">Blackjack Academy</h1>
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest">ベーシックストラテジー学習トレーナー</p>
        </div>
      </button>
      <div className="flex items-center gap-5">
        <div className="text-right">
          <p className="text-[9px] text-zinc-500 uppercase">残高</p>
          <p className="text-sm font-mono font-bold text-emerald-400">${bankroll.toLocaleString()}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] text-zinc-500 uppercase">戦略正答率</p>
          <p className="text-sm font-mono font-bold text-indigo-400">{accuracy.toFixed(1)}%</p>
        </div>
        <button onClick={onDashboard} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 cursor-pointer">📊 統計</button>
      </div>
    </header>
  );
}

// ── テーブル ──
function Table({ dealer, reveal, dealerShown, hands, active, phase }: { dealer: Card[]; reveal: boolean; dealerShown: number; hands: PlayerHand[]; active: number; phase: Phase }) {
  return (
    <div className="w-full rounded-3xl bg-[radial-gradient(circle_at_center,#0b5e44_0%,#04261c_100%)] border border-emerald-900/50 shadow-inner p-6 flex flex-col items-center justify-between gap-6 min-h-[340px]">
      {/* Dealer */}
      <div className="flex flex-col items-center gap-2">
        <div className="text-[10px] uppercase tracking-widest text-emerald-200/60">ディーラー {dealer.length > 0 && <span className="font-mono text-white ml-1">{reveal ? dealerShown : `${dealerShown}+?`}</span>}</div>
        <div className="flex gap-2">
          {dealer.length === 0 ? <CardBack /> : dealer.map((c, i) => <PlayingCard key={i} card={c} hidden={!reveal && i === 1} />)}
        </div>
      </div>

      {/* Player hands */}
      <div className="flex flex-wrap items-end justify-center gap-6">
        {hands.length === 0 ? (
          <div className="text-emerald-200/40 text-xs">「ディール」で開始</div>
        ) : hands.map((h, hi) => {
          const v = calculateHandValue(h.cards);
          const isActive = phase === 'playing' && hi === active && !h.done;
          return (
            <div key={hi} className={`flex flex-col items-center gap-2 rounded-2xl p-2 transition-all ${isActive ? 'ring-2 ring-amber-400/70 bg-black/10' : ''}`}>
              <div className="flex gap-2">{h.cards.map((c, i) => <PlayingCard key={i} card={c} />)}</div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-black/40 text-white">{v.value}{v.isSoft ? ' (ソフト)' : ''}</span>
                {h.doubled && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">DOUBLE</span>}
                {hands.length > 1 && <span className="text-[9px] text-emerald-200/60">ハンド{hi + 1}</span>}
                {h.result && <span className={`text-[10px] font-bold ${h.result === 'L' ? 'text-rose-400' : h.result === 'P' ? 'text-zinc-300' : 'text-emerald-400'}`}>{RESULT_JA[h.result]}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlayingCard({ card, hidden }: { card: Card; hidden?: boolean }) {
  if (hidden) return <CardBack />;
  const red = card.suit === '♥' || card.suit === '♦';
  return (
    <div className={`w-14 h-20 sm:w-16 sm:h-24 rounded-lg bg-white shadow-lg flex flex-col justify-between p-1.5 border border-zinc-300 ${red ? 'text-rose-600' : 'text-zinc-900'}`}>
      <span className="text-sm font-bold leading-none">{card.rank}</span>
      <span className="text-xl text-center leading-none">{card.suit}</span>
      <span className="text-sm font-bold leading-none self-end rotate-180">{card.rank}</span>
    </div>
  );
}
function CardBack() {
  return (
    <div className="w-14 h-20 sm:w-16 sm:h-24 rounded-lg bg-indigo-900 border border-indigo-600 flex items-center justify-center">
      <div className="w-9 h-14 rounded border border-indigo-400/40 flex items-center justify-center text-indigo-300/60 font-black text-xs">BJ</div>
    </div>
  );
}

function Ctrl({ label, sub, onClick, disabled, accent }: { label: string; sub: string; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`py-3 rounded-xl font-bold border-b-4 transition-all active:border-b-0 active:translate-y-1 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex flex-col items-center
        ${accent ? 'bg-indigo-600 hover:bg-indigo-500 border-indigo-800 shadow-lg shadow-indigo-500/20' : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-950'}`}>
      <span className="text-sm">{label}</span>
      <span className="text-[8px] uppercase tracking-widest opacity-60">{sub}</span>
    </button>
  );
}

// ── Footer ──
function Footer({ stats, tacticMode, onToggle }: { stats: any; tacticMode: boolean; onToggle: () => void; onDashboard: () => void }) {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-950 px-4 py-2.5 flex items-center gap-4 flex-wrap shrink-0 text-xs">
      <Stat label="ハンド数" value={String(stats.totalHands)} />
      <Stat label="勝率" value={`${stats.winRate.toFixed(0)}%`} />
      <Stat label="正答率" value={`${stats.accuracy.toFixed(0)}%`} accent />
      <Stat label="直近20手" value={`${stats.recentAcc}%`} />
      <div className="ml-auto">
        <button onClick={onToggle} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 cursor-pointer select-none">
          <div className="text-right leading-none">
            <p className="text-[8px] text-zinc-500 uppercase">初心者ヒント</p>
            <p className={`text-[10px] font-bold ${tacticMode ? 'text-emerald-400' : 'text-zinc-600'}`}>{tacticMode ? 'ON' : 'OFF'}</p>
          </div>
          <div className="w-8 h-4 bg-zinc-800 rounded-full relative">
            <div className={`absolute top-1 w-2 h-2 rounded-full transition-all ${tacticMode ? 'right-1 bg-emerald-500' : 'left-1 bg-zinc-600'}`}></div>
          </div>
        </button>
      </div>
    </footer>
  );
}
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[8px] text-zinc-600 uppercase tracking-wider">{label}</span>
      <span className={`font-mono font-bold ${accent ? 'text-indigo-400' : 'text-zinc-200'}`}>{value}</span>
    </div>
  );
}

// ── Home ──
function Home({ onStartTutorial, onSkip, hasHistory, onDashboard }: { onStartTutorial: () => void; onSkip: () => void; hasHistory: boolean; onDashboard: () => void }) {
  return (
    <Overlay>
      <h2 className="text-indigo-400 font-bold text-lg mb-1">Blackjack Academy へようこそ</h2>
      <p className="text-[13px] text-zinc-300 leading-relaxed mb-5">
        ブラックジャックを<b className="text-white">遊びながら基本戦略（ベーシックストラテジー）を学べる</b>トレーナーです。<br />
        確率は一切操作していません。あなたの選択ごとに<b className="text-emerald-300">「最適手」と理由</b>を表示し、上達をサポートします。
      </p>
      <div className="flex flex-col gap-2">
        <button onClick={onStartTutorial} className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer">📘 チュートリアルを見る（初心者向け）</button>
        <button onClick={onSkip} className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-bold cursor-pointer">▶ ルールは分かるので始める</button>
        {hasHistory && <button onClick={onDashboard} className="w-full py-2 rounded-xl text-zinc-400 hover:text-white text-xs cursor-pointer">これまでの成長を見る（統計）</button>}
      </div>
    </Overlay>
  );
}

// ── Tutorial ──
const TUTORIAL_PAGES = [
  { t: 'ゲームの目的', b: 'カードの合計を21に近づけ、ディーラーより高くすれば勝ち。ただし21を超える（バスト）と即負けです。最初に2枚配られ、ディーラーは1枚を公開しています。' },
  { t: 'カードの数え方', b: '2〜10はそのままの数。J・Q・Kは「10」。A（エース）は「1」または「11」の都合の良い方。例：A+8 = 19（ソフト19）。10+6 = 16（ハード16）。' },
  { t: '4つのアクション', b: '🃏 ヒット＝もう1枚引く / ✋ スタンド＝引かず確定 / ⏫ ダブル＝賭けを倍にして1枚だけ引いて確定 / ✂ スプリット＝同じ数字のペアを2つの手に分ける。' },
  { t: 'ディーラーのルール', b: 'あなたの番が終わると、ディーラーは伏せカードを公開し、合計17以上になるまで必ず引きます（ソフト17でも止まる=S17）。だから「ディーラーが2〜6（弱い）の時は無理に引かず待つ」のが定石です。' },
  { t: 'ベーシックストラテジーとは', b: '何百万回ものシミュレーションで導かれた「各局面で最も損が少ない最適手」の表です。これに従うのが数学的に最善。このアプリは毎回その最適手と理由を教えます。' },
  { t: '使い方', b: 'フッターの「初心者ヒント」をONにすると、選ぶ前に推奨アクションが表示されます。慣れたらOFFにして実力を試しましょう。各ハンド後のレポートと「📊 統計」であなたの成長を確認できます。' },
];
function Tutorial({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [page, setPage] = useState(0);
  const last = page === TUTORIAL_PAGES.length - 1;
  const p = TUTORIAL_PAGES[page];
  return (
    <Overlay>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-widest text-indigo-400 font-bold">チュートリアル {page + 1}/{TUTORIAL_PAGES.length}</span>
        <button onClick={onSkip} className="text-[11px] text-zinc-500 hover:text-white cursor-pointer">スキップ →</button>
      </div>
      <h3 className="text-white font-bold text-base mb-2">{p.t}</h3>
      <p className="text-[13px] text-zinc-300 leading-relaxed mb-5 min-h-[96px]">{p.b}</p>
      <div className="flex gap-1.5 justify-center mb-4">
        {TUTORIAL_PAGES.map((_, i) => <div key={i} className={`h-1.5 rounded-full transition-all ${i === page ? 'w-5 bg-indigo-400' : 'w-1.5 bg-zinc-700'}`} />)}
      </div>
      <div className="flex gap-2">
        {page > 0 && <button onClick={() => setPage(p => p - 1)} className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 font-bold text-sm cursor-pointer">戻る</button>}
        {!last
          ? <button onClick={() => setPage(p => p + 1)} className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-sm cursor-pointer">次へ</button>
          : <button onClick={onDone} className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-sm cursor-pointer">プレイ開始 ▶</button>}
      </div>
    </Overlay>
  );
}

// ── 各ハンドの結果＋戦略レポート（インライン：テーブルを隠さない） ──
function ResultView({ hands, dealer, decisions, net, onNext, onDashboard }: { hands: PlayerHand[]; dealer: Card[]; decisions: Decision[]; net: number; onNext: () => void; onDashboard: () => void }) {
  const dealerVal = calculateHandValue(dealer).value;
  const dealerBust = dealerVal > 21;
  const dealerBJ = isBlackjack(dealer);
  const correct = decisions.filter(d => d.correct).length;
  const acc = decisions.length ? Math.round((correct / decisions.length) * 100) : 100;
  const single = hands.length === 1 ? hands[0].result : null;
  const banner = single === 'BJ' ? { t: '🃏 ブラックジャック！勝ち', c: 'text-emerald-400' }
    : single === 'W' ? { t: '🎉 勝ち！', c: 'text-emerald-400' }
    : single === 'P' ? { t: '🤝 引き分け（プッシュ）', c: 'text-zinc-200' }
    : single === 'L' ? { t: '😖 残念、負け', c: 'text-rose-400' }
    : { t: 'スプリット結果', c: 'text-zinc-200' };
  const dealerLabel = dealerBJ ? 'ブラックジャック (21)' : dealerBust ? `バスト (${dealerVal})` : String(dealerVal);
  return (
    <div className="w-full space-y-3">
      {/* 結果サマリー（何を出して相手が何だったか一目で分かる） */}
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className={`text-lg font-black ${banner.c}`}>{banner.t}</span>
          <span className={`text-base font-mono font-bold ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-zinc-400'}`}>{net >= 0 ? '+' : ''}{net} チップ</span>
        </div>
        <div className="space-y-1.5">
          {hands.map((h, i) => {
            const pv = calculateHandValue(h.cards).value;
            const pBust = pv > 21;
            const r = h.result;
            return (
              <div key={i} className="flex items-center gap-x-2 gap-y-0.5 text-[13px] flex-wrap">
                {hands.length > 1 && <span className="text-[10px] text-zinc-500 w-11 shrink-0">ハンド{i + 1}</span>}
                <span className="text-zinc-300">あなた <b className={pBust ? 'text-rose-400' : 'text-white'}>{pBust ? `バスト (${pv})` : pv}</b></span>
                <span className="text-zinc-600">vs</span>
                <span className="text-zinc-300">ディーラー <b className={dealerBust ? 'text-rose-400' : 'text-white'}>{dealerLabel}</b></span>
                <span className="text-zinc-600">→</span>
                {r && <span className={`font-bold ${r === 'L' ? 'text-rose-400' : r === 'P' ? 'text-zinc-300' : 'text-emerald-400'}`}>{RESULT_JA[r]}</span>}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-zinc-500 mt-2.5">☝️ 上のテーブルでディーラーとあなたの最終手札（カード）を確認できます。</p>
      </div>

      {/* 戦略レポート */}
      {decisions.length > 0 ? (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/40">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500 px-3 pt-3 pb-1">戦略の解説（あなたの各選択）</p>
          <div className="divide-y divide-zinc-800">
            {decisions.map((d, i) => (
              <div key={i} className="p-3">
                <div className="flex items-center gap-2 text-[11px] mb-1 flex-wrap">
                  <span className={`font-bold ${d.correct ? 'text-emerald-400' : 'text-rose-400'}`}>{d.correct ? '✓ 最適' : '✗ 非最適'}</span>
                  <span className="text-zinc-400">自分の手 <b className="text-zinc-100">{d.total}{d.soft ? '(ソフト)' : ''}</b> / ディーラー <b className="text-zinc-100">{d.dealerUp}</b></span>
                  <span className="ml-auto text-zinc-400">あなた:<b className="text-zinc-200">{ACTION_JA[d.chosen]}</b>{!d.correct && <> → 最適:<b className="text-indigo-300">{ACTION_JA[d.optimal]}</b></>}</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{d.reason}</p>
              </div>
            ))}
          </div>
          <div className="text-center text-[12px] text-zinc-400 py-2 border-t border-zinc-800">このハンドの戦略正答率: <b className={acc === 100 ? 'text-emerald-400' : 'text-indigo-300'}>{acc}%</b>（{correct}/{decisions.length}）</div>
        </div>
      ) : (
        <p className="text-[12px] text-zinc-400 text-center py-2">最初の2枚で勝負がつきました（ブラックジャック等）。</p>
      )}

      {/* ボタン */}
      <div className="flex gap-2 pb-2">
        <button onClick={onNext} className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-sm cursor-pointer">次のハンド ▶</button>
        <button onClick={onDashboard} className="py-3 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 font-bold text-sm cursor-pointer">📊 統計</button>
      </div>
    </div>
  );
}

// ── ダッシュボード ──
function Dashboard({ stats, bankroll, onClose, onReset }: { stats: any; bankroll: number; onClose: () => void; onReset: () => void }) {
  return (
    <Overlay wide>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-indigo-400 font-bold text-base">📊 成長ダッシュボード</h3>
        <button onClick={onClose} className="text-[11px] text-zinc-400 hover:text-white cursor-pointer">閉じる ✕</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Kpi label="総ハンド数" value={String(stats.totalHands)} />
        <Kpi label="戦略正答率" value={`${stats.accuracy.toFixed(1)}%`} accent />
        <Kpi label="勝率" value={`${stats.winRate.toFixed(1)}%`} />
        <Kpi label="残高" value={`$${bankroll.toLocaleString()}`} />
      </div>

      {stats.rounds === 0 ? (
        <div className="text-center text-zinc-500 text-sm py-10">まだデータがありません。プレイすると成長グラフが表示されます。</div>
      ) : (
        <div className="space-y-4">
          <Panel title="戦略正答率の推移（累計）">
            <TrendChart data={stats.trend} />
          </Panel>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Panel title="勝敗分布">
              <WinLossBar wins={stats.wins} pushes={stats.pushes} losses={stats.losses} />
            </Panel>
            <Panel title="アクション別 正答率（最適手だった場面で正しく選べた割合）">
              <ActionBars data={stats.byAction} />
            </Panel>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            💡 「アクション別 正答率」で苦手な判断（例：ダブルやスプリットの見極め）が分かります。正答率の折れ線が右肩上がりなら順調に上達しています。
          </p>
        </div>
      )}

      <div className="flex gap-2 mt-5">
        <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-sm cursor-pointer">戻る</button>
        <button onClick={() => { if (confirm('全ての履歴と残高をリセットします。よろしいですか？')) onReset(); }} className="py-3 px-4 rounded-xl bg-zinc-800 hover:bg-rose-900/50 border border-zinc-700 text-rose-400 font-bold text-[11px] cursor-pointer">データ初期化</button>
      </div>
    </Overlay>
  );
}
function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-zinc-800/40 border border-zinc-700/50 p-3 text-center">
      <p className="text-[9px] text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className={`font-mono font-bold text-lg ${accent ? 'text-indigo-400' : 'text-zinc-100'}`}>{value}</p>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-zinc-900/40 border border-zinc-800 p-3">
      <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">{title}</p>
      {children}
    </div>
  );
}

// ── 自作SVG/バーチャート（依存ゼロ・確実に描画） ──
function TrendChart({ data }: { data: { round: number; accuracy: number }[] }) {
  if (!data || data.length === 0) return <div className="h-32 flex items-center justify-center text-zinc-600 text-xs">データなし</div>;
  const W = 300, H = 100, n = data.length;
  const pts = data.map((d, i) => [n === 1 ? W / 2 : (i / (n - 1)) * W, H - (d.accuracy / 100) * H] as const);
  const line = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[n - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const last = data[n - 1].accuracy;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-32">
        {[25, 50, 75].map(g => <line key={g} x1="0" y1={H - (g / 100) * H} x2={W} y2={H - (g / 100) * H} stroke="#27272a" strokeWidth="1" strokeDasharray="3 3" />)}
        <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#818cf8" stopOpacity="0.4" /><stop offset="100%" stopColor="#818cf8" stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill="url(#tg)" />
        <path d={line} fill="none" stroke="#818cf8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {n === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r="3" fill="#818cf8" />}
      </svg>
      <div className="flex justify-between text-[9px] text-zinc-500 mt-1">
        <span>開始</span>
        <span className="text-indigo-300 font-bold">現在の累計正答率 {last}%</span>
        <span>{n}ハンド</span>
      </div>
    </div>
  );
}

function WinLossBar({ wins, pushes, losses }: { wins: number; pushes: number; losses: number }) {
  const total = wins + pushes + losses || 1;
  return (
    <div className="py-3">
      <div className="flex h-5 w-full rounded-full overflow-hidden bg-zinc-800">
        <div style={{ width: `${(wins / total) * 100}%` }} className="bg-emerald-500" />
        <div style={{ width: `${(pushes / total) * 100}%` }} className="bg-zinc-500" />
        <div style={{ width: `${(losses / total) * 100}%` }} className="bg-rose-500" />
      </div>
      <div className="flex justify-between text-[11px] mt-3 font-mono">
        <span className="text-emerald-400">● 勝 {wins}</span>
        <span className="text-zinc-400">● 分 {pushes}</span>
        <span className="text-rose-400">● 負 {losses}</span>
      </div>
    </div>
  );
}

function ActionBars({ data }: { data: { action: string; rate: number; count: number }[] }) {
  return (
    <div className="space-y-2 py-1">
      {data.map(d => (
        <div key={d.action}>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-zinc-300">{d.action}</span>
            <span className="text-zinc-500 font-mono">{d.count > 0 ? `${d.rate}%（${d.count}回）` : '— 未経験'}</span>
          </div>
          <div className="h-2.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div style={{ width: `${d.count > 0 ? d.rate : 0}%` }} className={`h-full rounded-full transition-all ${d.rate >= 80 ? 'bg-emerald-500' : d.rate >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 共通オーバーレイ ──
function Overlay({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'} max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6`}>
        {children}
      </div>
    </div>
  );
}
