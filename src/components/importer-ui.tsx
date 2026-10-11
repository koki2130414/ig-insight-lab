"use client";
import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { importRows, type ImportResponse } from "@/app/actions";

type Field = { key: string; label: string; required?: boolean; aliases?: string[]; help?: string };
type Props = {
  accounts: { id: string; name: string }[];
  defaultAccount: string;
  kinds: Record<string, string>;
  fields: Record<string, Field[]>;
};

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;

function autoMap(fields: Field[], headers: string[]) {
  const map: Record<string, string> = {};
  for (const f of fields) {
    const cands = [f.key, f.label, ...(f.aliases ?? [])].map((s) => s.toLowerCase());
    const h = headers.find((h) => cands.includes(h.trim().toLowerCase()));
    if (h) map[f.key] = h;
  }
  return map;
}

export function Importer({ accounts, defaultAccount, kinds, fields }: Props) {
  const [account, setAccount] = useState(defaultAccount);
  const [kind, setKind] = useState("posts");
  const [measurement, setMeasurement] = useState<"measured" | "manual" | "estimated">("manual");
  const [filename, setFilename] = useState("");
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<Record<string, unknown>[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [committed, setCommitted] = useState(false);
  const [pending, start] = useTransition();
  const kindFields = fields[kind];

  const mapped = useMemo(
    () => raw.map((r) => Object.fromEntries(Object.entries(map).filter(([, h]) => h).map(([k, h]) => [k, r[h] ?? null]))),
    [raw, map],
  );
  const missingRequired = kindFields.filter((f) => f.required && !map[f.key]);

  function reset() {
    setResult(null);
    setCommitted(false);
  }

  async function onFile(file: File | undefined) {
    reset();
    setFileError(null);
    setRaw([]);
    setHeaders([]);
    if (!file) return;
    if (file.size > MAX_BYTES) return setFileError("ファイルは2MBまでです。分割して取り込んでください。");
    setFilename(file.name);
    const text = await file.text();
    let rows: Record<string, unknown>[] = [];
    if (file.name.toLowerCase().endsWith(".json")) {
      setFormat("json");
      try {
        const j = JSON.parse(text);
        const arr = Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : null;
        if (!arr) return setFileError("JSONは配列、または {\"rows\": [...]} の形にしてください。");
        rows = arr.filter((x: unknown) => x && typeof x === "object" && !Array.isArray(x));
      } catch {
        return setFileError("JSONを読み取れませんでした。");
      }
    } else {
      setFormat("csv");
      const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
      if (parsed.errors.length && !parsed.data.length) return setFileError(`CSVを読み取れませんでした: ${parsed.errors[0].message}`);
      rows = parsed.data;
    }
    if (rows.length > MAX_ROWS) return setFileError(`一度に取り込めるのは${MAX_ROWS}行までです（${rows.length}行）。`);
    const hs = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    setHeaders(hs);
    setRaw(rows);
    setMap(autoMap(fields[kind], hs));
  }

  function run(commit: boolean) {
    start(async () => {
      const r = await importRows({ accountId: account, kind: kind as never, rows: mapped, commit, filename, format, measurement });
      setResult(r);
      if (commit && r.ok) setCommitted(true);
    });
  }

  const rowStatus = new Map(result?.rows?.map((r) => [r.row, r]) ?? []);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label><span className="label">取り込み先アカウント</span>
          <select value={account} onChange={(e) => { setAccount(e.target.value); reset(); }} className="field">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label><span className="label">データの種類</span>
          <select value={kind} onChange={(e) => { setKind(e.target.value); setMap(autoMap(fields[e.target.value], headers)); reset(); }} className="field">
            {Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label><span className="label">計測区分</span>
          <select value={measurement} onChange={(e) => { setMeasurement(e.target.value as never); reset(); }} className="field">
            <option value="measured">実測（公式のエクスポートなど）</option>
            <option value="manual">手入力（画面を見て転記）</option>
            <option value="estimated">推定</option>
          </select>
        </label>
        <label><span className="label">ファイル（CSV / JSON・2MB・{MAX_ROWS}行まで）</span>
          <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => onFile(e.target.files?.[0])} className="field" />
        </label>
      </div>
      <p className="text-xs text-muted">
        テンプレート: <a className="underline" href={`/templates/${kind}.csv`} download>{kinds[kind]}のCSV</a>。日時は日本時間として解釈します。空欄は未取得（null）として保存し、0とは区別します。
      </p>
      {fileError && <p className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm">{fileError}</p>}

      {headers.length > 0 && (
        <div className="rounded-lg border border-line bg-white p-4">
          <h3 className="mb-2 text-sm font-bold">カラムの対応づけ（{raw.length}行）</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {kindFields.map((f) => (
              <label key={f.key} className="block">
                <span className="label">{f.label}{f.required && <span className="text-warn"> *</span>}</span>
                <select value={map[f.key] ?? ""} onChange={(e) => { setMap({ ...map, [f.key]: e.target.value }); reset(); }} className="field">
                  <option value="">（使わない）</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                {f.help && <span className="mt-0.5 block text-[11px] text-muted">{f.help}</span>}
              </label>
            ))}
          </div>
          {missingRequired.length > 0 && <p className="mt-2 text-sm text-warn">必須項目の対応づけが必要です: {missingRequired.map((f) => f.label).join("、")}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" disabled={pending || missingRequired.length > 0} onClick={() => run(false)}>{pending && !committed ? "確認中…" : "プレビューと入力チェック"}</button>
            <button type="button" className="btn" disabled={pending || missingRequired.length > 0 || !result || result.ok === false || committed} onClick={() => run(true)}>
              {pending ? "取り込み中…" : "エラーの無い行を取り込む"}
            </button>
          </div>
        </div>
      )}

      {result && !result.ok && <p className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm">{result.message}</p>}
      {result?.ok && (
        <div className={`rounded-md border px-3 py-2 text-sm ${committed ? "border-leaf/30 bg-leaf-soft" : "border-line bg-paper"}`} role="status">
          {committed
            ? <>取り込み完了: 追加 {result.inserted}件／重複のためスキップ {result.duplicates}件／エラー {result.errors}件</>
            : <>入力チェック: エラー {result.errors}件。重複は取り込み時に判定し、既存データは上書きしません。</>}
        </div>
      )}

      {mapped.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[640px] text-xs">
            <thead><tr className="border-b border-line text-left text-muted"><th className="p-2">行</th><th>状態</th>{kindFields.filter((f) => map[f.key]).map((f) => <th key={f.key} className="p-2">{f.label}</th>)}</tr></thead>
            <tbody>
              {mapped.slice(0, 50).map((r, i) => {
                const st = rowStatus.get(i + 1);
                return (
                  <tr key={i} className="border-b border-line/60 align-top">
                    <td className="p-2 text-muted">{i + 1}</td>
                    <td className="p-2">
                      {!st ? "—" : st.duplicate ? <span className="text-rice">重複スキップ</span> : st.ok ? <span className="text-leaf">OK</span> : <span className="text-warn">{st.errors.join(" / ")}</span>}
                    </td>
                    {kindFields.filter((f) => map[f.key]).map((f) => <td key={f.key} className="max-w-[220px] truncate p-2">{r[f.key] === null || r[f.key] === "" ? <span className="text-muted">（空）</span> : String(r[f.key])}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {mapped.length > 50 && <p className="p-2 text-xs text-muted">先頭50行を表示（全{mapped.length}行）。エラー行: {result?.rows?.filter((r) => !r.ok).map((r) => r.row).slice(0, 30).join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
