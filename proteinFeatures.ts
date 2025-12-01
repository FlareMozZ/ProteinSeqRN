export const AMINO_ACIDS: string[] = "ACDEFGHIKLMNPQRSTVWY".split("");
const AA_INDEX: Record<string, number> = AMINO_ACIDS.reduce(
  (m, aa, i) => ((m[aa] = i), m),
  {} as Record<string, number>
);

export const DIPEPTIDES: string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < AMINO_ACIDS.length; i++) {
    for (let j = 0; j < AMINO_ACIDS.length; j++) {
      out.push(AMINO_ACIDS[i] + AMINO_ACIDS[j]);
    }
  }
  return out;
})();

export const TRIPEPTIDES: string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < AMINO_ACIDS.length; i++) {
    for (let j = 0; j < AMINO_ACIDS.length; j++) {
      for (let k = 0; k < AMINO_ACIDS.length; k++) {
        out.push(AMINO_ACIDS[i] + AMINO_ACIDS[j] + AMINO_ACIDS[k]);
      }
    }
  }
  return out;
})();

export function computeFeaturesForSeq(seq: string) {
  const n = seq.length;
  const aaCounts = new Array(AMINO_ACIDS.length).fill(0);
  for (let i = 0; i < n; i++) {
    const c = seq[i];
    const idx = AA_INDEX[c];
    if (idx !== undefined) aaCounts[idx]++;
  }
  const aaComp = aaCounts.map((c) => (n > 0 ? c / n : 0));

  const totalDipep = Math.max(0, n - 1);
  const diCounts = new Array(DIPEPTIDES.length).fill(0);
  for (let i = 0; i + 1 < n; i++) {
    const a = seq[i], b = seq[i + 1];
    const ia = AA_INDEX[a], ib = AA_INDEX[b];
    if (ia !== undefined && ib !== undefined) {
      diCounts[ia * 20 + ib]++;
    }
  }
  const diComp = diCounts.map((c) => (totalDipep > 0 ? c / totalDipep : 0));

  const totalTri = Math.max(0, n - 2);
  const triCounts = new Array(TRIPEPTIDES.length).fill(0);
  for (let i = 0; i + 2 < n; i++) {
    const a = seq[i], b = seq[i + 1], c = seq[i + 2];
    const ia = AA_INDEX[a], ib = AA_INDEX[b], ic = AA_INDEX[c];
    if (ia !== undefined && ib !== undefined && ic !== undefined) {
      triCounts[ia * 400 + ib * 20 + ic]++;
    }
  }
  const triComp = triCounts.map((c) => (totalTri > 0 ? c / totalTri : 0));

  return { aaComp, diComp, triComp, length: n };
}

export function singleSeqToCsv(
  seq: string,
  geneName?: string,
  floatDigits?: number,
  meta?: { id?: string; description?: string; header?: string }
) {
  const { aaComp, diComp, triComp } = computeFeaturesForSeq(seq);
  const metaCols = ["ID", "Description", "Header", "GeneName"];
  const header = [...metaCols, ...AMINO_ACIDS, ...DIPEPTIDES, ...TRIPEPTIDES];
  
  const fmt = (x: number) => (typeof floatDigits === "number" ? x.toFixed(floatDigits) : String(x));
  const m = meta || {};
  
  // Note: UniProt data is explicitly excluded here for performance/bottleneck reasons
  const metaRow = [m.id ?? "", m.description ?? "", m.header ?? "", geneName ?? ""];
  const row = [...metaRow, ...aaComp.map(fmt), ...diComp.map(fmt), ...triComp.map(fmt)];
  
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.map(esc).join(","), row.map(esc).join(",")].join("\n");
}