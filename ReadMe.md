## Project Documentation: ProteinSeqRN

**ProteinSeqRN** is a cross-platform React Native application designed for rapid, on-device analysis and feature extraction of protein sequences. It supports manual sequence input and multi-sequence FASTA file processing, providing real-time visualizations and a comprehensive feature vector export suitable for downstream machine learning and bioinformatics workflows.

The application is built using React Native, Expo, and a custom set of protein feature calculation utilities.

***

### 1. Core Features

| Feature | Description | File(s) |
| :--- | :--- | :--- |
| **FASTA Processing** | Upload multi-sequence FASTA files, parse records, and generate a single multi-row CSV containing all extracted features. Processing is chunked for UI responsiveness. | `App.tsx` (util, upload logic) |
| **Protein Feature Extraction** | Calculates 20 Amino Acid (AA) composition, 400 Dipeptide composition, and 8000 Tripeptide composition values. | `proteinFeatures.ts` |
| **On-Device Visualization** | Provides real-time charts and data summaries for a single active sequence (manual input or selected FASTA record). | `App.tsx` (visualization components) |
| **UniProt Lookup** | Search UniProt by accession or gene name to fetch metadata, function, subcellular location, and disease information. | `App.tsx` (UniProt functions) |
| **Data Export** | Exports a CSV file with full feature vectors and a JSON file containing a Colab-style summary/preview of the dataset. | `App.tsx` (export logic) |

***

### 2. File Structure and Core Logic

The project consists of two main files:

#### A. `App.tsx` (Main Application)

This file manages the UI, state, file I/O, networking, and visualization components.

**Key Data Structures & States:**

* **`FastaRecord`**: Holds parsed FASTA data (`header`, `id`, `description`, `sequence`).
* **`RecordMeta`**: Stores metadata for FASTA browser (`idx`, `gene`, `length`, `first30`).
* **`Stats`**: Summary statistics (`length`, `composition`, `polarPct`).
* **State Management**: Uses `useState` to manage user input (`rawInput`, `geneName`), FASTA data (`records`, `metas`, `selectedIdx`), feature results (`csvOutput`, `previewJSON`), and UniProt query/results.

**Key Functions:**

| Function | Purpose |
| :--- | :--- |
| `parseFasta` | Splits a raw FASTA text string into an array of `FastaRecord` objects. |
| `buildCsvFromRecordsChunked` | Iterates over FASTA records, computes features using `proteinFeatures.ts`, and compiles a full CSV string in a non-blocking manner. |
| `fetchUniProt` / `fetchUniProtEntry` | Queries the UniProt REST API to fetch detailed annotation data, including **Subcellular Location**, **Disease**, and uses **GO Terms** as a fallback for the **Function** field. |
| `KPIChips` / `AABarChart` / `DipeptideHeatmap` / `TripeptideTopList` | Visualization components for displaying feature data in a responsive manner. |

#### B. `proteinFeatures.ts` (Feature Calculation Library)

This file contains the core computational logic for generating protein feature vectors.

**Key Constants:**

| Constant | Description | Size |
| :--- | :--- | :--- |
| `AMINO_ACIDS` | The 20 standard one-letter amino acid codes. | 20 |
| `DIPEPTIDES` | All possible pairs of amino acids. | 400 |
| `TRIPEPTIDES` | All possible triplets of amino acids. | 8,000 |

**Key Functions:**

| Function | Purpose |
| :--- | :--- |
| `computeFeaturesForSeq(seq: string)` | The primary feature computation function. Calculates the count and fractional composition for all 20 AA, 400 Dipeptides, and 8000 Tripeptides from the input sequence. |
| `singleSeqToCsv` | Formats the calculated features into a single CSV row, including optional metadata (ID, Description, Header, GeneName) followed by the 8420 feature values. |

***

### 3. UniProt Data Schema

The application normalizes data fetched from UniProt into an object structure to enrich the visualization and FASTA metadata.

| Field | Source | Note |
| :--- | :--- | :--- |
| `accession` | `primaryAccession` | UniProt Accession ID (e.g., A1KZ92). |
| `id` | `uniProtkbId` | UniProt Entry ID (e.g., PXDNL\_HUMAN). |
| `proteinName` | `proteinDescription.recommendedName.fullName.value` | Full protein name. |
| `organism` | `organism.scientificName` | Host species name. |
| `length` | `sequence.length` | Total number of amino acids. |
| `mass` | `sequence.molWeight` | Molecular weight in Daltons (Da). |
| `function` | `comments (type=FUNCTION)` or `goTerms (aspect=F)` | Priority is given to the text function comment; falls back to a semicolon-separated list of Molecular Function GO Terms. |
| `subcell` | `comments (type=SUBCELLULAR_LOCATION)` | Semicolon-separated list of subcellular locations. |
| `disease` | `comments (type=DISEASE)` | Associated disease/pathology description. |

***

### 4. Styling and Theme

The application uses a custom, dark, biology-oriented palette defined in `App.tsx` for visual consistency:

* **Background:** `#071923` (dark teal)
* **Card Background:** `#0B2E2E`
* **Primary Accent:** `#3AD3B2` (bright teal/mint)
* **Text/Subtle:** `#E8FFF8` / `#9ED8C3`