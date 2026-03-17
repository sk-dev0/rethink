// 各フェーズの文字数上限
const PHASE1_MAX_CHARS = 600;       // フェーズ1: 立場表明
const PHASE2_3_MAX_CHARS = 500;     // フェーズ2/3: 反論ターン
const PHASE4_MAX_CHARS = 650;       // フェーズ4: 統合表明

// リスト管理
const TOPIC_LIST_MAX = 30;          // 議論済み論点リストの最大保持件数
const SUB_TOPIC_MAX = 5;            // サブ議題の上限件数

// セマンティック分岐の閾値
const SEMANTIC_BRANCH_THRESHOLD = 0.7;

// フェーズ3の攻撃モードの順番（α→β を繰り返す2種類）
const PHASE3_ATTACK_MODES = ['α', 'β'];

module.exports = {
    PHASE1_MAX_CHARS,
    PHASE2_3_MAX_CHARS,
    PHASE4_MAX_CHARS,
    TOPIC_LIST_MAX,
    SUB_TOPIC_MAX,
    SEMANTIC_BRANCH_THRESHOLD,
    PHASE3_ATTACK_MODES,
};
