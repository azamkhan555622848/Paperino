// Renders a table from window.__DATA__ records. Numeric literals typed into
// table cells by hand are a lint failure — this is the only path.

export function renderTable(el, data, columns) {
  const table = document.createElement("table")
  table.className = "fig-table"
  const thead = table.createTHead()
  const hr = thead.insertRow()
  for (const col of columns) {
    const th = document.createElement("th")
    th.textContent = col.label ?? col.key
    if (col.align) th.style.textAlign = col.align
    hr.appendChild(th)
  }
  const tbody = table.createTBody()
  for (const row of data) {
    const tr = tbody.insertRow()
    for (const col of columns) {
      const td = tr.insertCell()
      const raw = row[col.key]
      td.textContent = col.format ? col.format(raw) : String(raw)
      if (col.align) td.style.textAlign = col.align
    }
  }
  el.replaceChildren(table)
}
