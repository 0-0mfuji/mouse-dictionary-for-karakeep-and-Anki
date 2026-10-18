import type { UdSentence } from "./readerLogic";

export const parseConllu = (conllu: string): UdSentence[] => {
  const sentences: UdSentence[] = [];
  let current: string[] = [];
  let currentText = "";
  const flush = () => {
    if (!current.length) return;
    const words = current.map((line) => {
      const columns = line.split("\t");
      return {
        id: Number(columns[0]),
        form: columns[1],
        lemma: columns[2] === "_" ? columns[1].toLowerCase() : columns[2],
        upos: columns[3],
        head: Number(columns[6]) || 0,
        deprel: columns[7],
      };
    });
    const reconstructed = words
      .map(
        (word, index) =>
          `${index > 0 && current[index - 1]?.split("\t")[9] !== "SpaceAfter=No" ? " " : ""}${word.form}`,
      )
      .join("");
    sentences.push({ text: currentText || reconstructed, words });
    current = [];
    currentText = "";
  };

  for (const line of conllu.split(/\r?\n/)) {
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("#")) {
      const text = line.match(/^# text = (.*)$/)?.[1];
      if (text) currentText = text;
      continue;
    }
    if (/^\d+-\d+\t/.test(line) || /^\d+\.\d+\t/.test(line)) continue;
    current.push(line);
  }
  flush();
  return sentences;
};
