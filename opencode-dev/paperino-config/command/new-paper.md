---
description: Scaffold a new Paperino paper workspace in the current project directory
---

Create a Paperino paper workspace for: $ARGUMENTS

Interpret $ARGUMENTS as the paper title, optionally ending with a venue keyword:
`nature` | `neurips` | `nejm` | `ieee`. Default venue: `neurips`.

Create exactly these files in the project root. If any already exist, stop and ask first.

1. `paperino.yaml`:

```yaml
title: <the title>
venue: <the venue keyword>
stage: drafting
```

2. `main.tex`:

```latex
\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}

\title{<the title>}
\author{}

\begin{document}
\maketitle

\input{sections/01-abstract}
\input{sections/02-introduction}
\input{sections/03-methods}
\input{sections/04-results}
\input{sections/05-discussion}

\end{document}
```

3. `sections/01-abstract.tex` through `sections/05-discussion.tex`. Each contains
only its heading plus a single `% TODO: draft from artifacts/` comment. The
abstract file uses `\begin{abstract}` / `\end{abstract}` instead of `\section{}`.
Every file must compile as-is.

4. `artifacts/README.md` — tell the user to drop raw research materials here
(results, data, notes, code), and that everything written in the paper must be
grounded in this folder.

5. `.gitignore` containing `.paperino/`

Then tell the user the workspace is ready, that the Paper panel will render the
skeleton PDF as soon as any `.tex` file is saved, and ask which research
artifacts they want to add first.
