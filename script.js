"use strict";

const byId = (id) => document.getElementById(id);
const selected = new Set();
const buttons = [];
const mainHeaders = Array.from({ length: 6 }, (_, i) => `本数字${i + 1}`);
const requiredHeaders = ["回号", "抽選日", ...mainHeaders, "ボーナス数字1"];
const combinationKey = (numbers) => [...numbers].sort((a, b) => a - b).join(",");
let history = null;
let matchesByKey = new Map();
let imported = null;

function parseCsv(text) {
  const rows = [];
  const fieldPattern = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))([,\r\n]|$)/y;
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let row = [];
  let moreFields = false;
  while (fieldPattern.lastIndex < text.length || moreFields) {
    const match = fieldPattern.exec(text);
    if (!match) throw new Error("CSVの引用符または区切り文字を確認してください。");
    const [, quoted, plain, separator] = match;
    row.push(quoted === undefined ? plain : quoted.replace(/""/g, '"'));
    moreFields = separator === ",";
    if (!moreFields) {
      if (row.some((value) => value.trim() !== "") || row.length > 1) rows.push(row);
      row = [];
    }
  }
  return rows;
}

function readInteger(value, pattern = /^\d+$/) {
  const match = value.normalize("NFKC").trim().match(pattern);
  return match ? Number(match[1] ?? match[0]) : NaN;
}

function normalizeDate(value) {
  const match = value.normalize("NFKC").trim().match(
    /^(\d{4})(?:([/.-])(\d{1,2})\2(\d{1,2})|年(\d{1,2})月(\d{1,2})日)$/,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[3] ?? match[5]);
  const day = Number(match[4] ?? match[6]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function validateCsv(text) {
  const [rawHeaders, ...rows] = parseCsv(text);
  if (!rawHeaders || !rows.length) throw new Error("履歴のデータ行がありません。");
  const headers = rawHeaders.map((name) => name.normalize("NFKC").trim());
  const columns = requiredHeaders.map((name) => headers.indexOf(name));
  if (columns.includes(-1) || new Set(headers).size !== headers.length) {
    throw new Error("必須列がそろっているか、同じ列名が複数ないか確認してください。");
  }
  const draws = [];
  const drawNumbers = new Set();
  const combinations = new Map();
  const errors = [];

  rows.forEach((row, index) => {
    const label = `データ行 ${index + 1}`;
    if (row.length !== headers.length) {
      errors.push(`${label}の列数が見出しと一致しません。`);
      return;
    }
    const [rawDraw, rawDate, ...values] = columns.map((column) => row[column]);
    const draw = readInteger(rawDraw, /^(?:第\s*)?(\d+)(?:\s*回)?$/);
    const date = normalizeDate(rawDate);
    const numbers = values.map((value) => readInteger(value));
    if (!Number.isSafeInteger(draw) || draw < 1) {
      errors.push(`${label}の回号が不正です。`);
    } else if (drawNumbers.has(draw)) {
      errors.push(`第${draw}回の回号が重複しています。`);
    } else {
      drawNumbers.add(draw);
    }
    if (!date) errors.push(`${label}の抽選日が不正です。`);
    const validNumbers = numbers.every((number) => Number.isInteger(number) && number >= 1 && number <= 43)
      && new Set(numbers).size === numbers.length;
    if (!validNumbers) errors.push(`${label}の本数字・ボーナス数字に範囲外、空欄、または重複があります。`);
    if (!Number.isSafeInteger(draw) || draw < 1 || !date || !validNumbers) return;
    const main = numbers.slice(0, 6).sort((a, b) => a - b);
    draws.push({ draw, date, main });
    const key = combinationKey(main);
    combinations.set(key, (combinations.get(key) ?? 0) + 1);
  });

  const sortedIds = [...drawNumbers].sort((a, b) => a - b);
  const gaps = [];
  let previous = 0;
  for (const draw of sortedIds) {
    if (draw > previous + 1) {
      gaps.push(draw === previous + 2 ? String(previous + 1) : `${previous + 1}〜${draw - 1}`);
    }
    previous = draw;
  }
  if (gaps.length) errors.push(`欠番があります（${gaps.slice(0, 12).join("、")}${gaps.length > 12 ? "、ほか" : ""}）。`);
  const repeated = [...combinations.values()].filter((count) => count > 1).length;
  const summary = `CSVのデータ行 ${rows.length.toLocaleString("ja-JP")}件`;
  if (errors.length) return { summary, errors };
  draws.sort((a, b) => a.draw - b.draw);
  return { summary, errors, data: { draws, repeated } };
}

function renderMessages(container, message, details = []) {
  container.textContent = message;
  if (!details.length) return;
  const list = document.createElement("ul");
  for (const detail of details) {
    const item = document.createElement("li");
    item.textContent = detail;
    list.append(item);
  }
  container.append(list);
}

function loadHistory(data) {
  history = data?.draws?.length ? data : null;
  matchesByKey = new Map();
  if (history) {
    for (const draw of history.draws) {
      const key = combinationKey(draw.main);
      if (!matchesByKey.has(key)) matchesByKey.set(key, []);
      matchesByKey.get(key).push(draw);
    }
    const first = history.draws[0];
    const last = history.draws.at(-1);
    byId("history-status").textContent =
      `${history.draws.length.toLocaleString("ja-JP")}件（第${first.draw}回〜第${last.draw}回、最終抽選日 ${last.date}）。欠番・回号重複・数字の不備なし。本数字の同一組み合わせが複数回出た組は${history.repeated}組です。`;
  } else {
    byId("history-status").textContent = "抽選履歴は未収録です。";
  }
  render();
}

function render() {
  const numbers = [...selected].sort((a, b) => a - b);
  const count = numbers.length;
  const odd = numbers.filter((number) => number % 2 === 1).length;
  const small = numbers.filter((number) => number <= 21).length;
  byId("count").textContent = `${count} / 6`;
  byId("parity").textContent = `${odd} / ${count - odd}`;
  byId("size").textContent = `${small} / ${count - small}`;
  byId("sum").textContent = numbers.reduce((total, number) => total + number, 0);
  byId("reset").disabled = !count;
  buttons.forEach((button, index) => {
    const pressed = selected.has(index + 1);
    button.setAttribute("aria-pressed", String(pressed));
    button.setAttribute("aria-disabled", String(count === 6 && !pressed));
  });
  byId("selected").replaceChildren(...Array.from({ length: 6 }, (_, index) => {
    const item = document.createElement("li");
    item.textContent = numbers[index] ?? "–";
    if (index >= count) {
      item.className = "empty";
      item.setAttribute("aria-hidden", "true");
    }
    return item;
  }));

  const result = byId("result");
  if (!history) {
    renderMessages(result, "抽選履歴は未収録です。下の「収録データとCSVの読み込み」からCSVを選択してください。");
  } else if (count < 6) {
    renderMessages(result, "数字を6個選ぶと照合結果が表示されます。");
  } else {
    const matches = matchesByKey.get(combinationKey(numbers)) ?? [];
    if (matches.length) {
      renderMessages(result, `${matches.length}件一致しました。`,
        matches.map(({ draw, date }) => `第${draw}回（抽選日 ${date}）`));
    } else {
      renderMessages(result, "収録済みの抽選履歴に同一組み合わせはありません");
    }
  }
}

for (let number = 1; number <= 43; number += 1) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "number";
  button.textContent = number;
  button.addEventListener("click", () => {
    if (selected.has(number)) selected.delete(number);
    else if (selected.size < 6) selected.add(number);
    else return;
    render();
  });
  buttons.push(button);
  byId("numbers").append(button);
}

byId("reset").addEventListener("click", () => {
  selected.clear();
  render();
  buttons[0].focus();
});

byId("csv").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file) return;
  input.disabled = true;
  imported = null;
  byId("download").hidden = true;
  byId("save-help").hidden = true;
  const status = byId("import-status");
  renderMessages(status, "CSVを検証しています。");
  try {
    const bytes = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
    }
    const report = validateCsv(text);
    if (report.errors.length) {
      const extra = report.errors.length - 12;
      const details = report.errors.slice(0, 12);
      if (extra > 0) details.push(`ほか${extra}件の問題があります。`);
      renderMessages(status, `${report.summary}を確認しました。読み込みに失敗しました。`, details);
      return;
    }
    imported = report.data;
    loadHistory(imported);
    renderMessages(status, `${report.summary}を検証し、読み込みました。`);
    byId("download").hidden = false;
    byId("save-help").hidden = false;
  } catch (error) {
    renderMessages(status, `読み込みに失敗しました。${error.message}`);
  } finally {
    input.value = "";
    input.disabled = false;
  }
});

byId("download").addEventListener("click", () => {
  if (!imported) return;
  const blob = new Blob([`window.LOTO6_HISTORY = ${JSON.stringify(imported)};\n`],
    { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "loto6-history.js";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

loadHistory(window.LOTO6_HISTORY);
