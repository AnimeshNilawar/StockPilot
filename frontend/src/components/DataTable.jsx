/**
 * Data table.
 *
 * `columns` entries are `{ key, header, render?, className?, align? }`; a plain
 * key renders the raw value, so the common case stays one line. Column widths
 * are driven by the header's `width` class rather than inline styles.
 */
export function DataTable({ columns, rows, getRowKey, empty }) {
  if (!rows || rows.length === 0) {
    return (
      empty || <p className="py-12 text-center text-sm text-slate-500">Nothing to show yet.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold tracking-wide text-slate-500 uppercase ${
                  column.align === 'right' ? 'text-right' : 'text-left'
                } ${column.headerClassName || ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, index) => (
            <tr
              key={getRowKey ? getRowKey(row, index) : (row.id ?? index)}
              className="hover:bg-slate-50"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-3 align-middle text-slate-700 ${
                    column.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                  } ${column.className || ''}`}
                >
                  {column.render ? column.render(row, index) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Badge({ children, className = 'bg-slate-100 text-slate-700' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export function ActiveBadge({ isActive }) {
  return (
    <Badge className={isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}>
      {isActive ? 'Active' : 'Inactive'}
    </Badge>
  );
}
