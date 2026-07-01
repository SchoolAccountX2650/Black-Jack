/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blackjack core logic — 公正なRNG・標準ルール・完全なベーシックストラテジー。
 * ルール: 6デッキシュー / ディーラーはソフト17でスタンド(S17) / ブラックジャック 3:2 /
 *         ダブルは最初の2枚(スプリット後も可=DAS) / スプリットは2手まで / サレンダー無し。
 * 確率は一切操作しない（Math.random による Fisher-Yates シャッフルのみ）。
 */

export type Suit = '♠' | '♣' | '♥' | '♦';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Action = 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number; // A=11(後で調整), J/Q/K=10
}

export const NUM_DECKS = 6;
export const RESHUFFLE_AT = 52; // 残り1デッキ未満で再シャッフル

export function createShoe(numDecks: number = NUM_DECKS): Card[] {
  const suits: Suit[] = ['♠', '♣', '♥', '♦'];
  const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const shoe: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        let value = parseInt(rank, 10);
        if (rank === 'A') value = 11;
        else if (rank === 'J' || rank === 'Q' || rank === 'K') value = 10;
        shoe.push({ suit, rank, value });
      }
    }
  }
  return shoe;
}

export const createDeck = createShoe;

export function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function calculateHandValue(hand: Card[]): { value: number; isSoft: boolean } {
  let value = 0;
  let aces = 0;
  for (const card of hand) {
    if (!card) continue; // 安全策：未定義カードはスキップ（白画面クラッシュ防止）
    if (card.rank === 'A') aces += 1;
    value += card.value;
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces -= 1;
  }
  return { value, isSoft: aces > 0 };
}

export function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && calculateHandValue(hand).value === 21;
}

export function isPair(hand: Card[]): boolean {
  return hand.length === 2 && hand[0].value === hand[1].value;
}

function dealerVal(up: Card): number {
  return up.value; // A=11、10/J/Q/K=10
}

export interface StrategyResult {
  action: Action;
  reason: string;
}

/**
 * 完全なベーシックストラテジー (S17 / DAS可 / サレンダー無し)。
 * canDouble / canSplit でその局面に「実際に選べる最善手」を返す。
 */
export function getOptimalAction(
  playerHand: Card[],
  dealerUp: Card,
  canDouble: boolean,
  canSplit: boolean
): StrategyResult {
  const { value: p, isSoft } = calculateHandValue(playerHand);
  const d = dealerVal(dealerUp);
  const dLabel = dealerUp.rank === 'A' ? 'A' : String(d);

  // ダブル推奨セルの解決。
  // doubleReason: ダブルできる時の理由 / elseReason: ダブルできない or 推奨外の時の理由
  const dbl = (cond: boolean, doubleReason: string, elseReason: string, elseAction: Action = 'HIT'): StrategyResult => {
    if (cond && canDouble) return { action: 'DOUBLE', reason: doubleReason };
    if (cond && !canDouble) {
      return { action: elseAction, reason: doubleReason + `（手札が3枚以上でダブル不可のため${elseAction === 'HIT' ? 'ヒット' : 'スタンド'}）` };
    }
    return { action: elseAction, reason: elseReason };
  };

  // ── ペア（スプリット判断） ──
  if (isPair(playerHand) && canSplit) {
    const r = playerHand[0].value;
    const splitVs = (set: number[], reason: string): StrategyResult => {
      if (set.includes(d)) return { action: 'SPLIT', reason };
      return { action: 'HIT', reason: `このペアはディーラー${dLabel}に対してスプリットが不利。通常の手として扱いヒット。` };
    };
    switch (r) {
      case 11:
        return { action: 'SPLIT', reason: 'A,A は常にスプリット。1枚ずつ11からやり直せて非常に有利。' };
      case 10:
        return { action: 'STAND', reason: '20 は非常に強い手。スプリットせずスタンドが最善（崩すべきでない）。' };
      case 9:
        if ([7, 10, 11].includes(d)) return { action: 'STAND', reason: `18 はディーラー${dLabel}に十分強いのでスタンド（7/10/A相手はスプリットしない）。` };
        return { action: 'SPLIT', reason: `9,9 はディーラー${dLabel}(弱〜中)に対しスプリットで2つの強い手を作る。` };
      case 8:
        return { action: 'SPLIT', reason: '8,8 は常にスプリット。16 のまま戦うより遥かに良い（最悪の手を作り直す）。' };
      case 7:
        return splitVs([2, 3, 4, 5, 6, 7], '7,7 はディーラー2〜7にスプリット（弱いディーラーに付け込む）。');
      case 6:
        return splitVs([2, 3, 4, 5, 6], '6,6 はディーラー2〜6(バストしやすい)にスプリット。');
      case 5:
        return dbl(d >= 2 && d <= 9, '5,5 はスプリットせずハード10として扱い、ディーラー2〜9にダブルダウン。',
          `5,5(=10) でもディーラー${dLabel}(10/A=強い)にはダブルせずヒット。`, 'HIT');
      case 4:
        return splitVs([5, 6], '4,4 はディーラー5〜6の時だけスプリット、それ以外はヒット。');
      case 3:
      case 2:
        return splitVs([2, 3, 4, 5, 6, 7], `${playerHand[0].rank},${playerHand[0].rank} はディーラー2〜7にスプリット。`);
    }
  }

  // ── ソフトハンド ──
  if (isSoft) {
    switch (p) {
      case 21:
      case 20:
        return { action: 'STAND', reason: `ソフト${p} は完成された強い手。スタンド。` };
      case 19:
        return { action: 'STAND', reason: 'ソフト19(A,8) はスタンド。十分強い。' };
      case 18: // A,7
        if ([3, 4, 5, 6].includes(d)) return dbl(true, `ソフト18(A,7)はディーラー${dLabel}(3〜6=弱い)にダブルが最適。`, '', 'STAND');
        if ([2, 7, 8].includes(d)) return { action: 'STAND', reason: `ソフト18(A,7)はディーラー${dLabel}(2/7/8)に対してスタンドが最善。` };
        return { action: 'HIT', reason: `ソフト18(A,7)はディーラー${dLabel}(9/10/A=強い)には18では足りないのでヒットして改善を狙う。` };
      case 17: // A,6
        return dbl([3, 4, 5, 6].includes(d), `ソフト17(A,6)はディーラー3〜6にダブルが最適。`,
          `ソフト17(A,6)はディーラー${dLabel}にはダブルせずヒットして改善を狙う(17では弱い)。`, 'HIT');
      case 16: // A,5
      case 15: // A,4
        return dbl([4, 5, 6].includes(d), `ソフト${p}はディーラー4〜6にダブルが最適。`,
          `ソフト${p}はディーラー${dLabel}にはヒットして手を伸ばす(バストしないので安全)。`, 'HIT');
      case 14: // A,3
      case 13: // A,2
        return dbl([5, 6].includes(d), `ソフト${p}はディーラー5〜6にダブルが最適。`,
          `ソフト${p}はディーラー${dLabel}にはヒットして手を伸ばす(バストしないので安全)。`, 'HIT');
      default:
        return { action: 'HIT', reason: `ソフト${p} はヒットして手を伸ばす。バストしないので安全に改善できる。` };
    }
  }

  // ── ハードハンド ──
  if (p >= 17) return { action: 'STAND', reason: `ハード${p} は高すぎてヒットするとバスト率が高い。スタンド。` };
  if (p >= 13 && p <= 16) {
    if (d >= 2 && d <= 6) return { action: 'STAND', reason: `ハード${p}でディーラー${dLabel}(2〜6=バストしやすい)。自分はバストを避けてスタンドし、ディーラーの自滅を待つ。` };
    return { action: 'HIT', reason: `ハード${p}でディーラー${dLabel}(7〜A=強い)。負け濃厚なのでヒットして手を改善する。` };
  }
  if (p === 12) {
    if (d >= 4 && d <= 6) return { action: 'STAND', reason: `ハード12はディーラー4〜6の時だけスタンド（ディーラーのバストに期待）。` };
    return { action: 'HIT', reason: `ハード12はディーラー${dLabel}に対してヒット（バスト率が比較的低く改善が見込める）。` };
  }
  if (p === 11) return dbl(d >= 2 && d <= 10, `11 は最強のダブル機会。ディーラー2〜10にダブル（10/Aが来れば21）。`,
    `11 でもディーラーA相手はダブルせずヒット（S17ではAが強く2倍掛けは不利）。`, 'HIT');
  if (p === 10) return dbl(d >= 2 && d <= 9, `10 はディーラー2〜9にダブルが最適。`,
    `10 でもディーラー${dLabel}(10/A=強い)にはダブルせずヒット。`, 'HIT');
  if (p === 9) return dbl([3, 4, 5, 6].includes(d), `9 はディーラー3〜6にダブルが最適。`,
    `9 はディーラー${dLabel}にはダブルせずヒットして手を伸ばす。`, 'HIT');
  return { action: 'HIT', reason: `ハード${p} は低いので必ずヒット（バストしない）。` };
}

export function describeHand(hand: Card[]): string {
  return hand.map(c => c.rank).join(',');
}

/** ディーラーがプレイ（S17）。新しい手札と使った後の山を返す（純粋関数）。 */
export function playDealer(dealerHand: Card[], shoe: Card[]): { hand: Card[]; shoe: Card[] } {
  const hand = [...dealerHand];
  const deck = [...shoe];
  while (calculateHandValue(hand).value < 17) {
    hand.push(deck.pop()!);
  }
  return { hand, shoe: deck };
}
