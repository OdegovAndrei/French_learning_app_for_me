// Immutable identities produced by buildCards() at baseline commit d935566.
// Changing one of these identities requires an explicit schedule/data migration.

const BASELINE_VOCABULARY = [
  ["vocab:l01:0", "bonjour", "здравствуйте / добрый день", "/bɔ̃.ʒuʁ/"],
  ["vocab:l01:1", "merci", "спасибо", "/mɛʁ.si/"],
  ["vocab:l01:2", "au revoir", "до свидания", "/o ʁə.vwaʁ/"],
  ["vocab:l02:0", "je m'appelle", "меня зовут", "/ʒə ma.pɛl/"],
  ["vocab:l02:1", "je suis", "я являюсь / я", "/ʒə sɥi/"],
  ["vocab:l02:2", "russe", "русский / русская", "/ʁys/"],
  ["vocab:l02:3", "enchanté", "очень приятно", "/ɑ̃.ʃɑ̃.te/"],
  ["vocab:l03:0", "comment", "как", "/kɔ.mɑ̃/"],
  ["vocab:l03:1", "tu t'appelles", "тебя зовут", "/ty ta.pɛl/"],
  ["vocab:l03:2", "et toi", "а ты", "/e twa/"],
  ["vocab:l04:0", "je voudrais", "я бы хотел", "/ʒə vu.dʁɛ/"],
  ["vocab:l04:1", "un café", "кофе", "/ɛ̃ ka.fe/"],
  ["vocab:l04:2", "de l'eau", "вода", "/də lo/"],
  ["vocab:l04:3", "s'il vous plaît", "пожалуйста", "/sil vu plɛ/"],
  ["vocab:l05:0", "est-ce que", "вопросительная частица", "/ɛs kə/"],
  ["vocab:l05:1", "vous avez", "у вас есть", "/vu.za.ve/"],
  ["vocab:l05:2", "du pain", "хлеб", "/dy pɛ̃/"],
  ["vocab:l05:3", "une baguette", "багет", "/yn ba.ɡɛt/"],
  ["vocab:l06:0", "excusez-moi", "извините", "/ɛk.sky.ze mwa/"],
  ["vocab:l06:1", "où", "где", "/u/"],
  ["vocab:l06:2", "le métro", "метро", "/lə me.tʁo/"],
  ["vocab:l06:3", "à droite", "справа", "/a dʁwat/"],
  ["vocab:l07:0", "demain", "завтра", "/də.mɛ̃/"],
  ["vocab:l07:1", "à quelle heure", "во сколько", "/a kɛ.lœʁ/"],
  ["vocab:l07:2", "je vais arriver", "я собираюсь приехать", "/ʒə vɛ a.ʁi.ve/"],
  ["vocab:l07:3", "parfait", "отлично", "/paʁ.fɛ/"],
  ["vocab:l08:0", "j'ai besoin de", "мне нужно", "/ʒe bə.zwɛ̃ də/"],
  ["vocab:l08:1", "aide", "помощь", "/ɛd/"],
  ["vocab:l08:2", "je ne comprends pas", "я не понимаю", "/ʒə nə kɔ̃.pʁɑ̃ pa/"],
  ["vocab:l08:3", "problème", "проблема", "/pʁɔ.blɛm/"],
];

const BASELINE_PHRASES = [
  ["phrase:l02:0", "phrase-note:l02:0", "phrase", "Меня зовут Андрей.", "Je m'appelle André."],
  ["phrase:l02:1", "phrase-note:l02:1", "phrase", "Я русский.", "Je suis russe."],
  ["phrase:l02:2", "phrase-note:l02:2", "cloze", "{{c1::Je suis}} russe.", "Я русский."],
  ["phrase:l03:0", "phrase-note:l03:0", "phrase", "Как тебя зовут?", "Comment tu t'appelles ?"],
  ["phrase:l03:1", "phrase-note:l03:1", "phrase", "А ты?", "Et toi ?"],
  ["phrase:l03:2", "phrase-note:l03:2", "cloze", "Comment {{c1::tu t'appelles}} ?", "Как тебя зовут?"],
  ["phrase:l04:0", "phrase-note:l04:0", "phrase", "Я бы хотел кофе, пожалуйста.", "Je voudrais un café, s'il vous plaît."],
  ["phrase:l04:2", "phrase-note:l04:2", "cloze", "{{c1::un}} café", "кофе, мужской род"],
  ["phrase:l05:0", "phrase-note:l05:0", "phrase", "У вас есть хлеб?", "Est-ce que vous avez du pain ?"],
  ["phrase:l05:2", "phrase-note:l05:2", "cloze", "{{c1::Est-ce que}} vous avez du pain ?", "Вопросительная рамка."],
  ["phrase:l06:0", "phrase-note:l06:0", "phrase", "Извините.", "Excusez-moi."],
  ["phrase:l06:1", "phrase-note:l06:1", "phrase", "Где метро?", "Où est le métro ?"],
  ["phrase:l07:0", "phrase-note:l07:0", "phrase", "Увидимся завтра?", "On se voit demain ?"],
  ["phrase:l07:2", "phrase-note:l07:2", "cloze", "{{c1::Je vais}} arriver à dix heures.", "Я собираюсь приехать в десять."],
  ["phrase:l08:0", "phrase-note:l08:0", "phrase", "Мне нужна помощь.", "J'ai besoin d'aide."],
  ["phrase:l08:1", "phrase-note:l08:1", "phrase", "Я не понимаю.", "Je ne comprends pas."],
  ["phrase:l08:2", "phrase-note:l08:2", "cloze", "{{c1::J'ai besoin de}} + nom", "Мне нужно + существительное"],
];

export function cardSemanticFingerprint(card) {
  return JSON.stringify([card.noteId, card.kind, card.front, card.back]);
}

const entries = [];

for (const [noteId, fr, ru, ipa] of BASELINE_VOCABULARY) {
  entries.push([
    `${noteId}:fr-ru`,
    cardSemanticFingerprint({ noteId, kind: "fr-ru", front: fr, back: ru })
  ]);
  entries.push([
    `${noteId}:ru-fr`,
    cardSemanticFingerprint({ noteId, kind: "ru-fr", front: ru, back: `${fr}\n${ipa}` })
  ]);
}

for (const [id, noteId, kind, front, back] of BASELINE_PHRASES) {
  entries.push([id, cardSemanticFingerprint({ noteId, kind, front, back })]);
}

export const LEGACY_CARD_MANIFEST = Object.freeze(Object.fromEntries(entries));
