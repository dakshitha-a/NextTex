# Forward census

- stress: 453 words; first box held the word 285; the flash holds it 448, as one line of type 444
- stress2: 198 words; first box held the word 94; the flash holds it 192, as one line of type 192

## Words the flash does not hold as one line

| doc | where | word | boxes | first | now | exact |
|---|---|---|---|---|---|---|
| stress | stress.tex:33:3 | a | 24 | false | true | false |
| stress | stress.tex:33:8 | b | 24 | true | true | false |
| stress | stress.tex:33:12 | c | 24 | true | true | false |
| stress | stress.tex:34:3 | d | 24 | false | true | false |
| stress | stress.tex:56:25 | the | 7 | true | false | false |
| stress | stress.tex:56:78 | the | 7 | false | false | false |
| stress | chapter.tex:7:26 | source | 2 | false | false | false |
| stress | chapter.tex:7:33 | line | 2 | false | false | false |
| stress | chapter.tex:9:9 | here | 2 | false | false | false |
| stress2 | stress2.tex:9:190 | Schrödinger | 7 | false | false | false |
| stress2 | stress2.tex:34:12 | Values | 3 | false | false | false |
| stress2 | stress2.tex:34:29 | sample | 3 | false | false | false |
| stress2 | stress2.tex:34:46 | mass | 3 | false | false | false |
| stress2 | stress2.tex:34:59 | width | 3 | false | false | false |
| stress2 | stress2.tex:34:73 | sample | 3 | true | false | false |

## Lines that set nothing

| line | source | first box | walked to | flashed |
|---|---|---|---|---|
| stress:1 | `\documentclass{article}` | p1 y135 | none | - |
| stress:2 | `\usepackage{amsmath,amssymb,xcolor,float,graphicx}` | p1 y135 | none | - |
| stress:3 | `\pagestyle{plain}` | p1 y135 | none | - |
| stress:4 | `\begin{document}` | p1 y135 | none | - |
| stress:5 | ` ` | p1 y135 | 6 | p1 y135 |
| stress:7 | ` ` | p1 y194 | 6 | p1 y135 |
| stress:9 | ` ` | p1 y242 | 8 | p1 y218 |
| stress:11 | ` ` | p1 y252 | 10 | p1 y242 |
| stress:13 | ` ` | p1 y300 | 12 | p1 y280 |
| stress:15 | ` ` | p1 y353 | 14 | p1 y324 |
| stress:17 | ` ` | p1 y371 | 16 | p1 y353 |
| stress:19 | ` ` | p1 y420 | 18 | p1 y395 |
| stress:21 | ` ` | p1 y441 | 20 | p1 y420 |
| stress:23 | ` ` | p1 y487 | 22 | p1 y451 |
| stress:25 | ` ` | p1 y508 | 24 | p1 y487 |
| stress:27 | `\begin{equation}` | p1 y508 | 26 | p1 y508 |
| stress:29 | `  \label{eq:energy}` | p1 y549 | 28 | p1 y549 |
| stress:30 | `\end{equation}` | p1 y549 | 31 | p1 y569 |
| stress:32 | `\begin{align}` | p1 y569 | 31 | p1 y569 |
| stress:35 | `\end{align}` | p1 y590 | 34 | p1 y593 p1 y608 |
| stress:37 | ` ` | p2 y138 | 36 | p1 y628 |
| stress:39 | ` ` | p2 y138 | 38 | p2 y138 |
| stress:40 | `\begin{table}[H]` | p2 y179 | 38 | p2 y138 |
| stress:41 | `  \centering` | p2 y179 | 42 | p2 y179 |
| stress:43 | `  \begin{tabular}{lcc}` | p2 y192 | 42 | p2 y179 |
| stress:47 | `  \end{tabular}` | p2 y216 | 46 | p2 y216 |
| stress:48 | `\end{table}` | p2 y216 | 46 | p2 y216 |
| stress:49 | ` ` | p1 y703 | 46 | p2 y216 |
| stress:50 | `\begin{figure}[H]` | p1 y703 | 53 | p2 y293 |
| stress:51 | `  \centering` | p2 y293 | 53 | p2 y293 |
| stress:52 | `  \rule{3cm}{1cm}` | p2 y293 | 53 | p2 y293 |
| stress:54 | `\end{figure}` | p2 y293 | 53 | p2 y293 |
| stress:55 | ` ` | p2 y319 | 56 | p2 y319 |
| stress:57 | ` ` | p2 y319 | 56 | p2 y319 |
| stress:58 | `\begin{itemize}` | p2 y341 | 59 | p2 y341 |
| stress:61 | `\end{itemize}` | p2 y361 | 60 | p2 y361 |
| stress:62 | `\begin{enumerate}` | p2 y383 | 63 | p2 y383 |
| stress:65 | `\end{enumerate}` | p2 y403 | 64 | p2 y403 |
| stress:66 | ` ` | p2 y436 | 67 | p2 y436 |
| stress:68 | ` ` | p2 y457 | 67 | p2 y436 |
| stress:70 | ` ` | p2 y481 | 69 | p2 y469 |
| stress:72 | ` ` | p2 y493 | 71 | p2 y481 |
| stress:74 | ` ` | p2 y529 | 73 | p2 y493 |
| stress:76 | ` ` | p2 y517 | 75 | p2 y541 |
| stress:78 | ` ` | p2 y596 | 77 | p2 y575 |
| stress:80 | ` ` | p2 y622 | 79 | p2 y596 |
| stress:82 | ` ` | p2 y640 | 81 | p2 y622 |
| stress:84 | ` ` | p3 y137 | 83 | p2 y640 |
| stress:86 | ` ` | p3 y137 | 85 | p3 y137 |
| stress:87 | `\input{chapter}` | p3 y703 | 85 | p3 y137 |
| stress:88 | ` ` | p3 y703 | 85 | p3 y137 |
| stress:89 | `\end{document}` | p3 y703 | 85 | p3 y137 |
| stress:90 | ` ` | p3 y703 | 85 | p3 y137 |
| stress2:1 | `\documentclass[twocolumn]{article}` | p1 y245 | none | - |
| stress2:2 | `\usepackage[T1]{fontenc}` | p1 y245 | none | - |
| stress2:3 | `\usepackage{lmodern,amsmath,amsthm,booktabs}` | p1 y245 | none | - |
| stress2:4 | `\newtheorem{theorem}{Theorem}` | p1 y245 | none | - |
| stress2:5 | `\begin{document}` | p1 y245 | none | - |
| stress2:6 | ` ` | p1 y245 | 7 | p1 y245 |
| stress2:8 | ` ` | p1 y266 | 7 | p1 y245 |
| stress2:10 | ` ` | p1 y266 | 9 | p1 y314 |
| stress2:12 | ` ` | p1 y392 | 11 | p1 y359 |
| stress2:14 | ` ` | p1 y416 | 13 | p1 y392 |
| stress2:17 | `\end{theorem}` | p1 y427 | 16 | p1 y439 |
| stress2:18 | ` ` | p1 y468 | 16 | p1 y439 |
| stress2:19 | `\begin{proof}` | p1 y468 | 20 | p1 y456 |
| stress2:21 | `\end{proof}` | p1 y480 | 20 | p1 y480 |
| stress2:22 | ` ` | p1 y480 | 20 | p1 y480 |
| stress2:23 | `\begin{table}[t]` | p1 y480 | 20 | p1 y480 |
| stress2:24 | `  \centering` | p1 y140 | 27 | p1 y140 |
| stress2:25 | `  \begin{tabular}{@{}lrr@{}}` | p1 y140 | 27 | p1 y140 |
| stress2:26 | `    \toprule` | p1 y140 | 27 | p1 y140 |
| stress2:28 | `    \midrule` | p1 y140 | 27 | p1 y140 |
| stress2:32 | `    \bottomrule` | p1 y184 | 31 | p1 y181 |
| stress2:33 | `  \end{tabular}` | p1 y140 | 34 | p1 y203 |
| stress2:35 | `  \label{tab:values}` | p1 y203 | 34 | p1 y215 |
| stress2:36 | `\end{table}` | p1 y203 | 34 | p1 y215 |
| stress2:37 | ` ` | p1 y505 | 39 | p1 y505 |
| stress2:38 | `\begin{description}` | p1 y505 | 39 | p1 y505 |
| stress2:41 | `\end{description}` | p1 y523 | 40 | p1 y523 |
| stress2:42 | ` ` | p1 y541 | 40 | p1 y523 |
| stress2:43 | `\begin{quote}` | p1 y541 | 44 | p1 y541 |
| stress2:45 | `\end{quote}` | p1 y541 | 44 | p1 y553 |
| stress2:46 | ` ` | p1 y570 | 47 | p1 y570 |
| stress2:48 | ` ` | p1 y624 | 47 | p1 y592 |
| stress2:52 | `\end{thebibliography}` | p1 y667 | 51 | p1 y667 |
| stress2:53 | ` ` | p1 y673 | 51 | p1 y667 |
| stress2:54 | `\end{document}` | p1 y673 | 51 | p1 y667 |
| stress2:55 | ` ` | p1 y673 | 51 | p1 y667 |
