import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  Platform,
  Linking,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  Pressable,
  KeyboardAvoidingView,
} from "react-native";

import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";

import {
  AMINO_ACIDS as AA_ORDER,
  computeFeaturesForSeq,
  singleSeqToCsv,
  DIPEPTIDES,
  TRIPEPTIDES,
} from "./proteinFeatures";

// ------------------ Theme (can be updated) ------------------
const palette = {
  // warmer, biology-oriented teal palette
  bg: "#071923",
  card: "#0B2E2E",
  cardAlt: "#072826",
  text: "#E8FFF8",
  subtle: "#9ED8C3",
  primary: "#3AD3B2",
  primaryStrong: "#18C39B",
  danger: "#FF6B6B",
  success: "#7AF2B2",
  border: "#0F524F",
  chip: "#083B39",
};
const spacing = (n: number) => n * 8;
const VALID_CHARS = new Set(AA_ORDER);

// ------------------ Types ------------------
type Stats = { length: number; composition: Record<string, number>; polarPct: number; };

type FastaRecord = { header: string; id?: string; description?: string; sequence: string };
type RecordMeta = { idx: number; gene: string; length: number; first30: string; id?: string; description?: string; header?: string; uniprot?: any };

type PreviewJSON = {
  total_sequences: number;
  first_sequences_preview: Array<{ index: number; length: number; first30: string }>;
  first_gene_names: string[];
  amino_acids: string[];
  aa_composition_first_sequence: Record<string, number>;
  total_dipeptides: number;
  first10_dipeptides: string[];
  dipeptide_composition_first_sequence_first10: Record<string, number>;
  total_tripeptides: number;
  first10_tripeptides: string[];
  tripeptide_composition_first_sequence_first10: Record<string, number>;
  feature_vector_preview_first3_first10: Array<Record<string, number>>;
  feature_table_shape: [number, number];
  head_rows: Array<Record<string, number | string>>;
  head_columns: string[];
};

// ------------------ Utils ------------------
function normalizeSequence(raw: string) {
  return raw.replace(/\s+/g, "").toUpperCase();
}
function extractGene(header: string) {
  const m = header.match(/GN=([^\s]+)/);
  return m ? m[1] : "";
}

function extractAccessionFromId(idStr?: string) {
  if (!idStr) return "";
  const parts = idStr.split("|");
  if (parts.length >= 2) return parts[1];
  return idStr;
}

function validateSequence(seq: string) {
  if (!seq) return { ok: false as const, message: "Sequence is empty." };
  for (let i = 0; i < seq.length; i++) {
    const ch = seq[i];
    if (!VALID_CHARS.has(ch)) {
      return { ok: false as const, message: `Invalid character “${ch}” at position ${i + 1}. Allowed: ${AA_ORDER.join("")}.` };
    }
  }
  return { ok: true as const };
}
function buildStatsFromFeatures(seq: string): Stats {
  const { aaComp, length } = computeFeaturesForSeq(seq);
  const composition: Record<string, number> = {};
  AA_ORDER.forEach((aa, i) => (composition[aa] = Math.round(aaComp[i] * length)));

  const polarSet = new Set(["D", "E", "K", "R", "H", "Q", "N", "S", "T", "Y"]);
  const polarCount = seq.split("").filter((c) => polarSet.has(c)).length;
  const polarPct = length ? Math.round((polarCount / length) * 100) : 0;

  return { length, composition, polarPct };
}
function getBaseDir() {
  return FileSystem.cacheDirectory || FileSystem.documentDirectory || FileSystem.cacheDirectory!;
}
function parseFasta(text: string): FastaRecord[] {
  const out: FastaRecord[] = [];
  const lines = text.split(/\r?\n/);
  let header = "", seq = "";
  for (const line of lines) {
    if (line.startsWith(">")) {
      if (header) {
        // split header into id (first token) and description (rest)
        const full = header;
        const [idToken, ...descParts] = full.split(/\s+/);
        const desc = descParts.join(" ") || "";
        out.push({ header: full, id: idToken || "", description: desc, sequence: seq });
      }
      header = line.slice(1).trim();
      seq = "";
    } else {
      seq += line.trim();
    }
  }
  if (header) {
    const full = header;
    const [idToken, ...descParts] = full.split(/\s+/);
    const desc = descParts.join(" ") || "";
    out.push({ header: full, id: idToken || "", description: desc, sequence: seq });
  }
  return out;
}
async function readPickedFileAsText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === "web") {
    const anyAsset = asset as any;
    if (anyAsset.file && typeof anyAsset.file.text === "function") {
      return await anyAsset.file.text();
    }
    const res = await fetch(asset.uri);
    return await res.text();
  }
  return await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
}
async function shareOrDownloadCsv(filename: string, csv: string) {
  if (Platform.OS === "web") {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    return;
  }
  const outUri = getBaseDir() + filename;
  await FileSystem.writeAsStringAsync(outUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(outUri, { dialogTitle: filename });
  else alert("Saved to: " + outUri);
}
async function shareOrDownloadJson(filename: string, obj: any) {
  const json = JSON.stringify(obj, null, 2);
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    return;
  }
  const outUri = getBaseDir() + filename;
  await FileSystem.writeAsStringAsync(outUri, json, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(outUri, { dialogTitle: filename });
  else alert("Saved to: " + outUri);
}

// table builder for many sequences without UI jank
async function buildCsvFromRecordsChunked(
  records: FastaRecord[],
  metas?: RecordMeta[],
  floatDigits?: number,
  onProgress?: (done: number, total: number) => void
) {
  // metadata columns + geneName (UniProt skipped in CSV for performance)
  const metaCols = ["ID", "Description", "Header", "GeneName"];
  const headerRow = [...metaCols, ...AA_ORDER, ...DIPEPTIDES, ...TRIPEPTIDES].join(",");
  const rows = [headerRow];

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const g = extractGene(r.header);
    const seq = normalizeSequence(r.sequence);
    const m = metas && metas[i] ? metas[i] : undefined;
    const metaObj = {
      id: r.id ?? (m as any)?.id ?? "",
      description: r.description ?? (m as any)?.description ?? "",
      header: r.header,
    };
    const csv = singleSeqToCsv(seq, g, floatDigits, metaObj as any);
    rows.push(csv.split("\n")[1]);

    if (onProgress && (i % 50 === 0 || i === records.length - 1)) onProgress(i + 1, records.length);
    if (i % 200 === 0) await new Promise((res) => setTimeout(res, 0)); // yield
  }
  return rows.join("\n");
}

// --------- Colab-style preview ----------
function featureRowForSeq(seq: string, geneName: string, meta?: RecordMeta) {
  const { aaComp, diComp, triComp } = computeFeaturesForSeq(seq);
  const row: Record<string, number | string> = {
    ID: meta?.id ?? "",
    Description: meta?.description ?? "",
    Header: meta?.header ?? "",
    GeneName: geneName,
  };
  AA_ORDER.forEach((aa, i) => (row[aa] = aaComp[i]));
  DIPEPTIDES.forEach((dp, i) => (row[dp] = diComp[i]));
  // populate tripeptide preview values for the head rows (be cautious, triComp length is 8000)
  TRIPEPTIDES.forEach((tp, i) => (row[tp] = triComp[i]));
  return row;
}
function buildPreviewJSON(records: FastaRecord[], metas?: RecordMeta[]): PreviewJSON {
  const total = records.length;
  const first3 = records.slice(0, 3).map((r, idx) => {
    const s = normalizeSequence(r.sequence);
    return { index: idx + 1, length: s.length, first30: s.slice(0, 30) + (s.length > 30 ? "..." : "") };
  });
  const geneNames = records.slice(0, 3).map(r => extractGene(r.header));

  const firstSeqNorm = records[0] ? normalizeSequence(records[0].sequence) : "";
  const firstAA = computeFeaturesForSeq(firstSeqNorm).aaComp;
  const aaCompFirst: Record<string, number> = {};
  AA_ORDER.forEach((aa, i) => (aaCompFirst[aa] = firstAA[i]));

  const first10DP = DIPEPTIDES.slice(0, 10);
  const firstDPComp = computeFeaturesForSeq(firstSeqNorm).diComp;
  const dpCompFirst10: Record<string, number> = {};
  first10DP.forEach((dp, i) => (dpCompFirst10[dp] = firstDPComp[i]));

  const first10TP = TRIPEPTIDES.slice(0, 10);
  const firstTPComp = computeFeaturesForSeq(firstSeqNorm).triComp;
  const tpCompFirst10: Record<string, number> = {};
  first10TP.forEach((tp, i) => (tpCompFirst10[tp] = firstTPComp[i]));

  const first10FeatureKeys = AA_ORDER.slice(0, 10);
  const fprev = records.slice(0, 3).map((r) => {
    const s = normalizeSequence(r.sequence);
    const { aaComp } = computeFeaturesForSeq(s);
    const obj: Record<string, number> = {};
    first10FeatureKeys.forEach((aa, i) => (obj[aa] = aaComp[i]));
    return obj;
  });

  const metaCols = ["ID", "Description", "Header", "GeneName"];
  const headCols = [...metaCols, ...AA_ORDER, ...DIPEPTIDES, ...TRIPEPTIDES];
  const headRows = records.slice(0, 5).map((r, idx) => {
    const g = extractGene(r.header);
    const s = normalizeSequence(r.sequence);
    const m = metas && metas[idx] ? metas[idx] : undefined;
    return featureRowForSeq(s, g, m);
  });

  return {
    total_sequences: total,
    first_sequences_preview: first3,
    first_gene_names: geneNames,
    amino_acids: AA_ORDER,
    aa_composition_first_sequence: aaCompFirst,
    total_dipeptides: DIPEPTIDES.length,
    first10_dipeptides: first10DP,
    dipeptide_composition_first_sequence_first10: dpCompFirst10,
    total_tripeptides: TRIPEPTIDES.length,
    first10_tripeptides: first10TP,
    tripeptide_composition_first_sequence_first10: tpCompFirst10,
    feature_vector_preview_first3_first10: fprev,
    feature_table_shape: [total, metaCols.length + AA_ORDER.length + DIPEPTIDES.length + TRIPEPTIDES.length],
    head_rows: headRows,
    head_columns: headCols,
  };
}
function toColabStyleText(p: PreviewJSON) {
  const lines: string[] = [];
  lines.push(`Total sequences read: ${p.total_sequences}`);
  lines.push(`First 3 sequences preview:`);
  p.first_sequences_preview.forEach(s =>
    lines.push(`Seq${s.index} length=${s.length}, first 30 aa: ${s.first30}`)
  );
  lines.push(`\nFirst 3 extracted gene names:\n${JSON.stringify(p.first_gene_names)}`);
  // if head_rows provided include first 3 ID/Description samples (if present)
  if (p.head_rows && p.head_rows[0]) {
    const sampleIds = p.head_rows.slice(0, 3).map(r => ({ ID: (r as any).ID, Description: (r as any).Description }));
    lines.push(`\nFirst 3 IDs/descriptions:\n${JSON.stringify(sampleIds)}`);
  }
  lines.push(`\nList of amino acids considered: ${JSON.stringify(p.amino_acids)}`);
  lines.push(`\nAmino acid composition example for first sequence:\n${JSON.stringify(p.aa_composition_first_sequence)}`);
  lines.push(`\nTotal dipeptides considered: ${p.total_dipeptides}`);
  lines.push(`First 10 dipeptides: ${JSON.stringify(p.first10_dipeptides)}`);
  lines.push(`\nDipeptide composition example for first sequence (first 10 values):\n${JSON.stringify(p.dipeptide_composition_first_sequence_first10)}`);
  lines.push(`\nTotal tripeptides considered: ${p.total_tripeptides}`);
  lines.push(`First 10 tripeptides: ${JSON.stringify(p.first10_tripeptides)}`);
  lines.push(`\nTripeptide composition example for first sequence (first 10 values):\n${JSON.stringify(p.tripeptide_composition_first_sequence_first10)}`);
  lines.push(`\nGenerating full feature table...`);
  lines.push(`\nFeature vector preview for sequence 1:\n${JSON.stringify(p.feature_vector_preview_first3_first10[0])}`);
  if (p.feature_vector_preview_first3_first10[1])
    lines.push(`\nFeature vector preview for sequence 2:\n${JSON.stringify(p.feature_vector_preview_first3_first10[1])}`);
  if (p.feature_vector_preview_first3_first10[2])
    lines.push(`\nFeature vector preview for sequence 3:\n${JSON.stringify(p.feature_vector_preview_first3_first10[2])}`);
  lines.push(`\nFeature table shape: (${p.feature_table_shape[0]}, ${p.feature_table_shape[1]})`);

  const headColsShown = ["GeneName", ...AA_ORDER.slice(0, 10)];
  lines.push(`First 5 rows of feature table (GeneName + first 10 AA cols):`);
  const header = headColsShown.join("\t");
  lines.push(header);
  p.head_rows.forEach(row => {
    const line = headColsShown.map(k => (row as any)[k]).join("\t");
    lines.push(line);
  });

  return lines.join("\n");
}

// ------------------ NEW: Visualization (responsive) ------------------

// KPI chips: quick biological intuition
function KPIChips({ aaComp, length }: { aaComp: number[]; length: number }) {
  const hydrophobicSet = new Set(["A", "V", "L", "I", "F", "W", "Y", "M"]);
  const chargedSet = new Set(["D", "E", "K", "R", "H"]);
  const polarSet = new Set(["D","E","K","R","H","Q","N","S","T","Y"]);

  let hydrophobic = 0, charged = 0, polar = 0;
  AA_ORDER.forEach((aa, i) => {
    const v = aaComp[i];
    if (hydrophobicSet.has(aa)) hydrophobic += v;
    if (chargedSet.has(aa)) charged += v;
    if (polarSet.has(aa)) polar += v;
  });

  const Chip = ({ label, value }:{label:string; value:string}) => (
    <View style={styles.kpiChip}><Text style={styles.kpiChipText}>{label}: <Text style={styles.kpiChipNum}>{value}</Text></Text></View>
  );

  return (
    <View style={styles.kpiRow}>
      <Chip label="Length" value={String(length)} />
      <Chip label="Hydrophobic %" value={`${Math.round(hydrophobic*100)}`} />
      <Chip label="Charged %" value={`${Math.round(charged*100)}`} />
      <Chip label="Polar %" value={`${Math.round(polar*100)}`} />
    </View>
  );
}

// Responsive 20-bar chart without external libs
function AABarChart({ aaComp }: { aaComp: number[] }) {
  const [w, setW] = useState(0);
  const onLayout = useCallback((e:any)=>setW(e.nativeEvent.layout.width), []);
  const gap = 6;
  const pad = 8;
  const bars = AA_ORDER.length;
  const max = Math.max(...aaComp, 0.00001);

  const trackWidth = Math.max(10, Math.min(28, Math.floor((w - pad*2 - gap*(bars-1)) / bars)));
  const chartH = 160;

  return (
    <View onLayout={onLayout}>
      <Text style={styles.sectionLabel}>Amino Acid Composition</Text>
      <View style={[styles.barChart, { height: chartH }]}>
        {AA_ORDER.map((aa, i) => {
          const h = `${(aaComp[i] / max) * 100}%`;
          return (
            <View key={aa} style={[styles.barItem, { width: trackWidth, marginRight: i === bars-1 ? 0 : gap }]}>
              <View style={[styles.barTrack, { width: trackWidth, height: chartH - 20 }]}>
                <View style={[styles.barFill, { height: (aaComp[i] / max) * (chartH - 20) }]} />
              </View>
              <Text style={styles.barLabel}>{aa}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.barHint}>Bars normalized to the most frequent residue.</Text>
    </View>
  );
}

// Responsive 20×20 dipeptide heatmap
function DipeptideHeatmap({ diComp }: { diComp: number[] }) {
  const [w, setW] = useState(0);
  const onLayout = useCallback((e:any)=>setW(e.nativeEvent.layout.width), []);
  const M = 20;
  const labelsW = 22 + 2; // left row labels + small gap
  const gap = 2; // margin inside cell style already
  const usableW = Math.max(0, w - labelsW);

  // Compute cell size; keep between 8 and 18 px. If too small, user can scroll horizontally (container is in a Card)
  const cell = Math.max(8, Math.min(18, Math.floor((usableW - (M*gap)) / M)));

  const max = Math.max(...diComp, 0);
  const matrix = Array.from({ length: M }, (_, r) =>
    Array.from({ length: M }, (_, c) => diComp[r * M + c])
  );

  return (
    <View onLayout={onLayout}>
      <Text style={styles.sectionLabel}>Dipeptide Heatmap (20×20)</Text>
      <ScrollView horizontal>
        <View>
          {/* Column headers */}
          <View style={{ flexDirection: "row", marginLeft: 22 }}>
            {AA_ORDER.map((aa) => (
              <Text key={aa} style={[styles.hmHeaderCol, { width: cell }]}>{aa}</Text>
            ))}
          </View>
          {/* Grid + row headers */}
          <View style={{ flexDirection: "row" }}>
            <View style={{ marginTop: 2 }}>
              {AA_ORDER.map((aa) => (
                <Text key={aa} style={[styles.hmHeaderRow, { height: cell }]}>{aa}</Text>
              ))}
            </View>
            <View>
              {matrix.map((row, r) => (
                <View style={{ flexDirection: "row" }} key={`r-${r}`}>
                  {row.map((v, c) => {
                    const alpha = max ? v / max : 0;
                    return (
                      <View
                        key={`c-${c}`}
                        style={[
                          styles.hmCell,
                          { width: cell, height: cell, backgroundColor: `rgba(94,129,255,${alpha})` },
                        ]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
      <Text style={styles.barHint}>Darker = more frequent. Max cell: {max.toFixed(4)}</Text>
    </View>
  );
}

// Top N tripeptides list (practical way to visualize 8k features)
function TripeptideTopList({ triComp, topN = 30 }: { triComp: number[]; topN?: number }) {
  if (!triComp || triComp.length === 0) return null;
  // collect top indices
  const items = triComp
    .map((v, i) => ({ i, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, topN);
  const max = items.length ? items[0].v || 1e-6 : 1e-6;

  return (
    <View>
      <Text style={styles.sectionLabel}>Top {topN} Tripeptides</Text>
      <ScrollView style={{ maxHeight: 320 }}>
        {items.map(({ i, v }) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Text style={{ width: 90, color: palette.text, fontWeight: "700" }}>{TRIPEPTIDES[i]}</Text>
            <View style={{ flex: 1 }}>
              <View style={styles.statBarTrack}><View style={[styles.statBarFill, { width: `${(v / max) * 100}%` }]} /></View>
              <Text style={{ color: palette.subtle, fontSize: 12 }}>{(v * 100).toFixed(3)}%</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ------------------ UI components ------------------
function Header() {
  return (
    <View style={styles.header} accessibilityRole="header">
      <Text style={styles.title}>ProteinSeqRN</Text>
      <Text style={styles.subtitle}>Modern RN app for protein sequence workflows</Text>
    </View>
  );
}
function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}
function PrimaryButton({ label, onPress, disabled, style }: { label: string; onPress: () => void; disabled?: boolean; style?: any }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.primaryBtn,
        disabled && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.98 }] },
        style
      ]}
    >
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}
function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.75 }]}>
      <Text style={styles.ghostBtnText}>{label}</Text>
    </Pressable>
  );
}
function ProteinInput({
  value, error, onChange, onClear, geneName, onGeneNameChange,
}: {
  value: string; error?: string | null; onChange: (next: string) => void; onClear: () => void;
  geneName: string; onGeneNameChange: (next: string) => void;
}) {
  return (
    <View>
      <SectionLabel>1. Input Sequence</SectionLabel>
      <Text style={styles.monoHint}>Paste a protein sequence (1-letter codes). Allowed: {AA_ORDER.join("")}</Text>
      <TextInput
        accessibilityLabel="Protein sequence input"
        value={value}
        onChangeText={onChange}
        placeholder="e.g., MTEITAAMVKELRESTGAGMMDCK..."
        placeholderTextColor={palette.subtle}
        autoCorrect={false}
        autoCapitalize="characters"
        multiline
        style={styles.textarea}
      />
      <Text style={[styles.sectionLabel, { marginTop: spacing(2), textTransform: "none" }]}>Gene Name (optional)</Text>
      <TextInput
        accessibilityLabel="Gene name input"
        value={geneName}
        onChangeText={onGeneNameChange}
        placeholder="e.g., HSP70"
        placeholderTextColor={palette.subtle}
        autoCorrect={false}
        style={[styles.textarea, { minHeight: 44 }]}
      />
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.inputActionsRow}><GhostButton label="Clear" onPress={onClear} /></View>
    </View>
  );
}
function StatBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View style={{ marginBottom: spacing(1) }}>
      <View style={styles.statBarTrack}><View style={[styles.statBarFill, { width: `${pct}%` }]} /></View>
    </View>
  );
}
function StatsPanel({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  const maxAA = Math.max(...Object.values(stats.composition));
  return (
    <Card>
      <SectionLabel>2. Sequence Summary</SectionLabel>
      <View style={{ gap: spacing(1.5) }}>
        <Text style={styles.kpi}>Length: <Text style={styles.kpiNumber}>{stats.length}</Text></Text>
        <Text style={styles.kpi}>Polar ratio (demo): <Text style={styles.kpiNumber}>{stats.polarPct}%</Text></Text>
        <View style={styles.compGrid}>
          {AA_ORDER.map((aa) => (
            <View key={aa} style={styles.compCell}>
              <Text style={styles.compAA}>{aa}</Text>
              <StatBar value={stats.composition[aa]} max={maxAA || 1} />
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}
function FooterNote() {
  return (<View style={styles.footer}><Text style={styles.footerText}>Built with React Native · iOS · Android · Web</Text></View>);
}

// ------------------ NEW: Sequence Browser ------------------
function SequenceBrowser({
  metas, selectedIdx, onSelect, onUseInInput,
}: {
  metas: RecordMeta[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  onUseInInput: (idx: number) => void;
}) {
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState(150); // paginate to keep it snappy

  const filtered = useMemo(() => {
    if (!q) return metas;
    const qq = q.toLowerCase();
    return metas.filter(m =>
      m.gene.toLowerCase().includes(qq) ||
      String(m.idx + 1).includes(qq)
    );
  }, [q, metas]);

  const visibleMetas = filtered.slice(0, visible);
  const hasMore = filtered.length > visible;

  const Row = ({ item }: { item: { idx: number; gene: string; length: number; first30: string; id?: string; description?: string } }) => {
    const active = selectedIdx === item.idx;
    return (
      <Pressable
        onPress={() => onSelect(item.idx)}
        style={[
          styles.seqRow,
          active && { backgroundColor: "#1b244e", borderColor: palette.primary },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.seqTitle}>
            #{item.idx + 1} · {item.gene || "(no GN)"} · len {item.length}
          </Text>
          <Text style={styles.seqSub}>{item.first30}</Text>
        </View>
        <GhostButton label="Use in Input" onPress={() => onUseInInput(item.idx)} />
      </Pressable>
    );
  };

  return (
    <Card style={{ gap: 8 }}>
      <SectionLabel>Sequence Browser</SectionLabel>

      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search by gene or #index"
        placeholderTextColor={palette.subtle}
        style={[styles.textarea, { minHeight: 44 }]}
      />

      {/* Fixed-height inner scroller to avoid page-height explosion */}
      <ScrollView
        style={{ height: 260 }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {visibleMetas.map((m) => (
          <Row key={m.idx} item={m} />
        ))}
        {hasMore && (
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <PrimaryButton
              label={`Show more (${visible}/${filtered.length})`}
              onPress={() => setVisible((v) => v + 150)}
            />
          </View>
        )}
        {filtered.length === 0 && (
          <Text style={styles.subtleText}>No matches for “{q}”.</Text>
        )}
      </ScrollView>

      <Text style={styles.subtleText}>
        Tap a row to visualize; “Use in Input” copies it to the input (for single-row CSV export).
      </Text>
    </Card>
  );
}

// ------------------ Main ------------------
export default function App() {
  const [rawInput, setRawInput] = useState("");
  const [geneName, setGeneName] = useState("");
  const [csvOutput, setCsvOutput] = useState<string | null>(null);

  // preview states
  const [previewJSON, setPreviewJSON] = useState<PreviewJSON | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);

  // NEW: hold uploaded records & metas and a selected index
  const [records, setRecords] = useState<FastaRecord[] | null>(null);
  const [metas, setMetas] = useState<RecordMeta[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const { width } = useWindowDimensions();

  // UniProt lookup states
  const [uniprotQuery, setUniprotQuery] = useState("");
  const [uniprotLoading, setUniprotLoading] = useState(false);
  const [uniprotError, setUniprotError] = useState<string | null>(null);
  const [uniprotResults, setUniprotResults] = useState<Array<any>>([]);

  // helper to pick a sensible default query: prefer accession from selected record ID, else geneName
  const defaultUniProtQuery = useMemo(() => {
    if (selectedIdx != null && metas[selectedIdx]) {
      const idtok = metas[selectedIdx].id || "";
      const acc = extractAccessionFromId(idtok);
      if (acc) return acc;
    }
    if (geneName) return geneName;
    return "";
  }, [selectedIdx, metas, geneName]);

  // If a sequence is selected from the browser, visualize that; otherwise use the manual input
  const currentSeq = useMemo(() => {
    if (selectedIdx != null && records && records[selectedIdx]) {
      return normalizeSequence(records[selectedIdx].sequence);
    }
    return normalizeSequence(rawInput);
  }, [selectedIdx, records, rawInput]);

  const validation = useMemo(() => validateSequence(currentSeq), [currentSeq]);

  // compute features once for the active visualization target
  const features = useMemo(() => (validation.ok ? computeFeaturesForSeq(currentSeq) : null), [validation, currentSeq]);
  const stats = useMemo(() => (validation.ok ? buildStatsFromFeatures(currentSeq) : null), [validation, currentSeq]);

  useEffect(() => { if (!rawInput) setRawInput("MTEITAAMVKELRESTGAGMMDCK"); }, []);
  const isWide = width >= 900;

  // UniProt search helper (FIXED API CALL)
  async function fetchUniProt(query: string) {
    if (!query || !query.trim()) throw new Error("Query empty");
    setUniprotLoading(true);
    setUniprotError(null);
    setUniprotResults([]);
    try {
      const params = new URLSearchParams();
      // Valid fields for UniProtKB: accession, id, protein_name, organism_name, length, cc_function
      const fields = ["accession", "id", "protein_name", "organism_name", "length", "cc_function", "cc_subcellular_location", "cc_disease", "sequence", "go"];
      params.append("format", "json");
      params.append("fields", fields.join(","));

      let url = "";
      // Check if query looks like a specific accession to use the direct endpoint
      if (/^[A-Za-z0-9]{6,10}$/.test(query)) {
        url = `https://rest.uniprot.org/uniprotkb/${query}?${params.toString()}`;
      } else {
        // Otherwise search
        params.append("query", query);
        params.append("size", "5");
        url = `https://rest.uniprot.org/uniprotkb/search?${params.toString()}`;
      }
      
      // Inside App.tsx -> fetchUniProt function

// ... previous setup code ...
const r = await fetch(url, { headers: { accept: "application/json" } });
// ... error handling ...
const j = await r.json();

const rawHits = j.results ? j.results : [j];

const hits = rawHits.map((h: any) => {
    const accession = h.primaryAccession || h.accession || "";
    const id = h.uniProtkbId || h.id || "";
    const proteinName = h.proteinDescription?.recommendedName?.fullName?.value || h.proteinName || "";
    const organism = h.organism?.scientificName || h.organism_name || "";
    const length = h.sequence?.length || h.length || 0;
    
    const comments = h.comments || [];
    const goTerms = h.goTerms || []; // GO terms are now available here

    // 1. Function: Prioritize the dedicated FUNCTION comment
    const funcComment = comments.find((c:any) => c.type === 'FUNCTION')?.texts?.[0]?.value || "";
    
    // 2. GO Terms Fallback: Use Molecular Function (Aspect 'F')
    const goFunction = goTerms
        .filter((g: any) => g.goAspect === 'F') // Filter by Molecular Function aspect ('F')
        .map((g: any) => g.term)
        .join("; ");
        
    const func = funcComment || goFunction || ""; // Use function comment, or GO function terms

    // 3. Subcellular Location
    const subcell = comments
      .filter((c:any) => c.type === 'SUBCELLULAR_LOCATION')
      .flatMap((c:any) => c.subcellularLocations?.map((l:any) => l.location?.value))
      .filter(Boolean)
      .join("; ");

    // 4. Disease / Pathology
    const disease = comments.find((c:any) => c.type === 'DISEASE')?.disease?.description || "";

    // 5. Mass (Daltons)
    const mass = h.sequence?.molWeight ? `${h.sequence.molWeight} Da` : "";
    
    const urlEntry = accession ? `https://www.uniprot.org/uniprotkb/${accession}` : undefined;
    
    // Return the expanded object
    return { accession, id, proteinName, organism, length, function: func, subcell, disease, mass, url: urlEntry };
});



setUniprotResults(hits);
      // const r = await fetch(url, { headers: { accept: "application/json" } });
      // if (!r.ok) {
      //   throw new Error(`UniProt search failed: ${r.status}`);
      // }
      // const j = await r.json();
      
      // // Normalize single entry vs search results
      // const rawHits = j.results ? j.results : [j];
      
      // const hits = rawHits.map((h: any) => {
      //   const accession = h.primaryAccession || h.accession || "";
      //   const id = h.uniProtkbId || h.id || ""; // API returns 'uniProtkbId' in search or 'id' in entry
      //   const proteinName = h.proteinDescription?.recommendedName?.fullName?.value || h.proteinName || "";
      //   const organism = h.organism?.scientificName || h.organism_name || "";
      //   const length = h.sequence?.length || h.length || 0;
      //   // Function comment extraction
      //   const func = h.cc_function || (h.comments ? h.comments.find((c:any)=>c.type==='FUNCTION')?.texts[0]?.value : "") || "";
      //   const urlEntry = accession ? `https://www.uniprot.org/uniprotkb/${accession}` : undefined;
        
      //   return { accession, id, proteinName, organism, length, function: func, url: urlEntry };
      // });
      
      // setUniprotResults(hits);
      setUniprotLoading(false);
    } catch (err: any) {
      setUniprotLoading(false);
      setUniprotError(err?.message ?? String(err));
    }
  }

  const doSearchUniProt = () => {
    const q = uniprotQuery || defaultUniProtQuery;
    fetchUniProt(q);
  };

  const openUniProtEntry = async (url?:string) => {
    if (!url) return;
    try {
      if (Platform.OS === 'web') window.open(url, '_blank');
      else await Linking.openURL(url);
    } catch (e) { console.warn('Failed to open URL', e); }
  };

  const handleSaveCurrentCsv = async () => {
    try {
      // If we have a computed CSV (from upload), use it
      if (csvOutput && records) {
          await shareOrDownloadCsv("protein_features_view.csv", csvOutput);
          return;
      }
      // Otherwise generate for single sequence
      if (!features) return;
      const csv = singleSeqToCsv(currentSeq, geneName.trim() || undefined);
      await shareOrDownloadCsv("protein_features.csv", csv);
    } catch (e: any) {
      console.warn(e); alert("Failed to save CSV: " + (e?.message ?? String(e)));
    }
  };

  const handleSaveJSON = async () => {
    try {
      if (!previewJSON) return alert("No JSON preview available.");
      await shareOrDownloadJson("protein_features_preview.json", previewJSON);
    } catch (e: any) {
      console.warn(e); alert("Failed to save JSON: " + (e?.message ?? String(e)));
    }
  };

  const handleUploadFasta = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/plain", "text/*", "application/octet-stream", "text/x-fasta", "application/fasta"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;

      const asset = result.assets![0];
      const content = await readPickedFileAsText(asset);
      const recs = parseFasta(content);
      if (recs.length === 0) return alert("No valid FASTA records found.");

      setRecords(recs);
      const m: RecordMeta[] = recs.map((r, idx) => {
        const s = normalizeSequence(r.sequence);
        return { idx, gene: extractGene(r.header), length: s.length, first30: s.slice(0, 30) + (s.length > 30 ? "..." : ""), id: r.id ?? "", description: r.description ?? "", header: r.header };
      });
      setMetas(m);
      setSelectedIdx(0);

      // Generate Preview & CSV immediately (REMOVED BACKGROUND UNIPROT LOOP)
      const preview = buildPreviewJSON(recs, m);
      setPreviewJSON(preview);
      setPreviewText(toColabStyleText(preview));

      setCsvOutput("Processing CSV...");
      const fullCsv = await buildCsvFromRecordsChunked(recs, m, undefined, (done: number, total: number) => {
        setCsvOutput(`Processing CSV ${done}/${total}...`);
      });
      setCsvOutput(fullCsv);
      
    } catch (e: any) {
      console.warn(e);
      alert("Failed to process FASTA file: " + (e?.message ?? String(e)));
    }
  };

  const handleUseInInput = (idx: number) => {
    if (!records) return;
    const r = records[idx];
    setRawInput(normalizeSequence(r.sequence));
    const g = extractGene(r.header);
    if (g) setGeneName(g);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <Header />

          {/* 1. INPUT SEQUENCE AND UNIPROT LOOKUP IN ONE AREA */}
          <View style={[styles.grid, { flexDirection: isWide ? "row" : "column" }]}>
             <Card style={{ flex: 1 }}>
                <ProteinInput
                    value={rawInput}
                    error={validateSequence(normalizeSequence(rawInput)).ok ? null : validateSequence(normalizeSequence(rawInput)).message}
                    onChange={setRawInput}
                    onClear={() => setRawInput("")}
                    geneName={geneName}
                    onGeneNameChange={setGeneName}
                />
                <View style={{ marginTop: spacing(2), borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing(2) }}>
                    <SectionLabel>UniProt Lookup</SectionLabel>
                    <Text style={styles.subtleText}>Search by Accession or Gene (for metadata only)</Text>
                    <View style={{ flexDirection: 'row', gap: spacing(1) }}>
                        <TextInput
                            value={uniprotQuery}
                            onChangeText={setUniprotQuery}
                            placeholder={defaultUniProtQuery || "e.g., A0A0B4J2F0"}
                            placeholderTextColor={palette.subtle}
                            style={[styles.textarea, { minHeight: 44, flex: 1 }]}
                        />
                        <PrimaryButton label={uniprotLoading ? "..." : "Search"} onPress={doSearchUniProt} />
                    </View>
                    <View style={{marginTop: 8}}>
                        <GhostButton label="Or Upload FASTA File" onPress={handleUploadFasta} />
                    </View>
                    {uniprotError && <Text style={styles.errorText}>{uniprotError}</Text>}
                </View>
             </Card>
          </View>

          {/* Sequence Browser if Multi-Fasta */}
          {metas.length > 0 && (
            <SequenceBrowser
                metas={metas}
                selectedIdx={selectedIdx}
                onSelect={setSelectedIdx}
                onUseInInput={handleUseInInput}
            />
          )}

          {/* 2. SEQUENCE SUMMARY AND UNIPROT ANALYSIS */}
          <View style={[styles.grid, { flexDirection: isWide ? "row" : "column" }]}>
             <View style={{ flex: 1 }}>
                <StatsPanel stats={stats} />
             </View>
             <View style={{ flex: 1 }}>
                {/* <Card style={{height: '100%'}}>
                    <SectionLabel>UniProt Analysis</SectionLabel>
                    {uniprotResults.length > 0 ? (
                         uniprotResults.map((r, i) => (
                            <View key={i} style={{ marginBottom: 16 }}>
                                <Text style={{ color: palette.text, fontWeight: '700' }}>{r.accession} · {r.id}</Text>
                                <Text style={styles.subtleText}>{r.proteinName} ({r.organism})</Text>
                                <Text style={{ color: palette.text, marginTop: 4, fontSize: 12 }}>{r.function ? r.function.slice(0, 300) + (r.function.length>300?"...":"") : "No function description available."}</Text>
                                <GhostButton label="Open on UniProt" onPress={() => openUniProtEntry(r.url)} />
                            </View>
                         ))
                    ) : (
                        <Text style={styles.subtleText}>No UniProt data loaded. Use the lookup tool above.</Text>
                    )}
                </Card> */}
                {/* Inside the return statement -> UniProt Analysis Card */}
<Card style={{ height: '100%' }}>
  <SectionLabel>UniProt Analysis</SectionLabel>
  {uniprotResults.length > 0 ? (
    uniprotResults.map((r, i) => (
      <View key={i} style={{ marginBottom: 16 }}>
        {/* Header */}
        <Text style={{ color: palette.text, fontWeight: '700', fontSize: 16 }}>
          {r.id} <Text style={{ color: palette.subtle, fontSize: 14 }}>({r.accession})</Text>
        </Text>
        <Text style={styles.subtleText}>{r.proteinName}</Text>
        <Text style={[styles.subtleText, { fontStyle: 'italic' }]}>{r.organism}</Text>

        {/* New Fields */}
        <View style={{ marginTop: 12, gap: 6 }}>
          {/* Mass & Length row */}
          <Text style={styles.subtleText}>
            <Text style={{ fontWeight: '700', color: palette.subtle }}>Length:</Text> {r.length} aa
            {r.mass ? `  •  ${r.mass}` : ""}
          </Text>

          {/* Location */}
          {r.subcell ? (
            <Text style={{ color: palette.text, fontSize: 12 }}>
              <Text style={{ fontWeight: '700', color: palette.primary }}>Loc:</Text> {r.subcell}
            </Text>
          ) : null}

          {/* Disease */}
          {r.disease ? (
            <Text style={{ color: palette.text, fontSize: 12 }}>
              <Text style={{ fontWeight: '700', color: palette.danger }}>Pathology:</Text> {r.disease}
            </Text>
          ) : null}

          {/* Function */}
          {/* <Text style={{ color: palette.text, fontSize: 12, lineHeight: 18 }}>
            <Text style={{ fontWeight: '700', color: palette.subtle }}>Func:</Text>{" "}
            {r.function ? r.function.slice(0, 300) + (r.function.length > 300 ? "..." : "") : "No function description available."}
          </Text> */}
          {/* Function Display */}
<Text style={{ color: palette.text, fontSize: 12, lineHeight: 18 }}>
  <Text style={{ fontWeight: '700', color: palette.subtle }}>Func:</Text>{" "}
  {r.function ? (
      r.function.slice(0, 300) + (r.function.length > 300 ? "..." : "")
  ) : (
      "No function description available."
  )}
  {r.function && r.function.includes(";") && !r.function.includes("FUNCTION") ? (
      <Text style={{ fontStyle: 'italic', color: palette.subtle, fontSize: 10 }}> (Derived from GO Terms)</Text>
  ) : null}
</Text>
        </View>

        <View style={{ marginTop: 8 }}>
          <GhostButton label="Open on UniProt" onPress={() => openUniProtEntry(r.url)} />
        </View>
      </View>
    ))
  ) : (
    <Text style={styles.subtleText}>No UniProt data loaded. Use the lookup tool above.</Text>
  )}
</Card>
             </View>
          </View>

          {/* 3. COMPOSITION HEATMAP AND TRIPEPTIDES */}
          {features && (
            <>
              <Card>
                <KPIChips aaComp={features.aaComp} length={features.length} />
              </Card>

              <View style={[styles.grid, { flexDirection: isWide ? "row" : "column" }]}>
                 <Card style={{ flex: 1 }}>
                    <AABarChart aaComp={features.aaComp} />
                 </Card>
                 <Card style={{ flex: 1 }}>
                    <DipeptideHeatmap diComp={features.diComp} />
                 </Card>
              </View>

              <Card>
                <TripeptideTopList triComp={features.triComp} />
              </Card>
            </>
          )}

          {/* 4. DOWNLOAD BUTTONS */}
          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), justifyContent: 'center' }}>
                <PrimaryButton 
                    label="Download CSV" 
                    onPress={handleSaveCurrentCsv} 
                    disabled={!features}
                />
                <PrimaryButton 
                    label="Download JSON" 
                    onPress={handleSaveJSON} 
                    disabled={!previewJSON}
                    style={{ backgroundColor: palette.primaryStrong }}
                />
          </Card>

          {/* 5. COLAB STYLE PREVIEW */}
          {previewText && (
            <Card>
              <SectionLabel>Colab-style Summary</SectionLabel>
              <ScrollView horizontal>
                <Text
                  selectable
                  style={{
                    fontFamily: Platform.select({
                      web: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      default: "monospace",
                    }),
                    padding: spacing(1),
                    color: palette.text,
                  }}
                >
                  {previewText}
                </Text>
              </ScrollView>
            </Card>
          )}

          <FooterNote />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ------------------ Styles (Restored) ------------------
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.bg },
  container: { padding: spacing(2), gap: spacing(2) },
  header: { gap: spacing(0.5), paddingVertical: spacing(1) },
  title: { color: palette.text, fontSize: 28, fontWeight: "700", letterSpacing: 0.5 },
  subtitle: { color: palette.subtle, fontSize: 14 },
  sectionLabel: {
    color: palette.subtle,
    marginBottom: spacing(1),
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: 16,
    padding: spacing(2),
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    gap: spacing(1),
  },
  textarea: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: spacing(1.5),
    color: palette.text,
    backgroundColor: palette.cardAlt,
    fontFamily: Platform.select({
      web: "ui-monospace, SFMono-Regular, Menlo, monospace",
      default: "monospace",
    }),
    lineHeight: 20,
  },
  monoHint: {
    color: palette.subtle,
    fontSize: 12,
    marginBottom: spacing(1),
    fontFamily: Platform.select({
      web: "ui-monospace, SFMono-Regular, Menlo, monospace",
      default: "monospace",
    }),
  },
  errorText: { color: palette.danger, marginTop: spacing(1) },
  inputActionsRow: { marginTop: spacing(1), flexDirection: "row", gap: spacing(1), justifyContent: "flex-end" },
  primaryBtn: {
    backgroundColor: palette.primary,
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(2),
    borderRadius: 12,
    marginTop: spacing(1.5),
    marginRight: spacing(1),
  },
  primaryBtnText: { color: palette.bg, fontWeight: "700", fontSize: 15 },
  ghostBtn: {
    backgroundColor: palette.chip,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.5),
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    marginTop: spacing(1),
  },
  ghostBtnText: { color: palette.text, fontWeight: "600" },
  statBarTrack: { height: 8, backgroundColor: palette.chip, borderRadius: 999, overflow: "hidden" },
  statBarFill: { height: 8, backgroundColor: palette.primaryStrong },
  kpi: { color: palette.subtle, fontSize: 14 },
  kpiNumber: { color: palette.text, fontWeight: "700" },
  compGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1.5) },
  compCell: { width: "22%", minWidth: 80 },
  compAA: { color: palette.text, fontWeight: "700", marginBottom: spacing(0.5) },
  grid: { gap: spacing(2), alignItems: "flex-start" },
  col: { gap: spacing(2) },
  subtleText: { color: palette.subtle, marginBottom: spacing(1) },
  footer: { marginTop: spacing(1), paddingVertical: spacing(2), alignItems: "center" },
  footerText: { color: palette.subtle, fontSize: 12 },

  // Visualization styles
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  kpiChip: {
    backgroundColor: palette.chip,
    paddingVertical: spacing(0.75),
    paddingHorizontal: spacing(1.25),
    borderRadius: 999,
    borderWidth: 1, borderColor: palette.border,
  },
  kpiChipText: { color: palette.subtle, fontSize: 12 },
  kpiChipNum: { color: palette.text, fontWeight: "700" },

  barChart: { flexDirection: "row", alignItems: "flex-end" },
  barItem: { alignItems: "center" },
  barTrack: {
    borderRadius: 6,
    backgroundColor: palette.chip, overflow: "hidden",
    borderWidth: 1, borderColor: palette.border, justifyContent: "flex-end",
  },
  barFill: { width: "100%", backgroundColor: palette.primaryStrong },
  barLabel: { color: palette.subtle, fontSize: 10, marginTop: 4 },
  barHint: { color: palette.subtle, fontSize: 12, marginTop: 6 },

  hmHeaderCol: { textAlign: "center", color: palette.subtle, fontSize: 10, marginHorizontal: 1 },
  hmHeaderRow: { textAlign: "center", color: palette.subtle, fontSize: 10, marginVertical: 1 },
  hmCell: {
    margin: 1, borderRadius: 2,
    borderWidth: 1, borderColor: "rgba(29,39,80,0.35)",
  },

  // Sequence browser
  seqRow: {
    borderWidth: 1, borderColor: palette.border,
    borderRadius: 12, padding: spacing(1),
    backgroundColor: palette.cardAlt,
    flexDirection: "row", alignItems: "center", gap: spacing(1),
    marginBottom: spacing(1),
  },
  seqTitle: { color: palette.text, fontWeight: "700" },
  seqSub: { color: palette.subtle, fontFamily: Platform.select({ web: "ui-monospace, Menlo, monospace", default: "monospace" }) },
});