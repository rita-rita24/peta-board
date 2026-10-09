function fixture(n) {
  const columns = Array.from({ length: n === 500 ? 12 : 4 }, (_, c) => ({
    id: `c${c}`,
    title: `列${c}`,
    notes: [],
  }));
  for (let i = 0; i < n; i++)
    columns[i % columns.length].notes.push({
      id: `n${i}`,
      title: `付箋${i}`,
      body: ("詳細情報 " + (i % 2 ? "通常" : "検証対象") + " abc ").repeat(
        n === 500 ? 200 : 5,
      ),
      tags: ["仕事", "検証"],
      dueDate: "2026-10-01",
      color: "paper",
      createdAt: 1,
      updatedAt: 1,
      checklist: Array.from({ length: n === 500 ? 30 : 3 }, (_, j) => ({
        id: `i${i}_${j}`,
        text: `確認${j}`,
        done: j % 2 === 0,
      })),
    });
  return {
    version: 1,
    theme: "light",
    settings: { defaultColor: "paper" },
    board: { title: "計測ボード", createdAt: 1, updatedAt: 1, columns },
  };
}
module.exports = fixture;
