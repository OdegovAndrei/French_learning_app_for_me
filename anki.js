export function buildAnkiTsv(cards) {
  const headers = [
    "#separator:Tab",
    "#html:false",
    "#tags column:4",
    "#columns:Front\tBack\tLesson\tTags"
  ];

  const lines = cards.map((card) => {
    const tags = ["FrenchStudy", card.lessonId, card.type || card.kind].filter(Boolean).join(" ");
    return [card.front, card.back, card.lessonTitle, tags]
      .map(quoteTsvField)
      .join("\t");
  });

  return [...headers, ...lines].join("\n");
}

function quoteTsvField(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
