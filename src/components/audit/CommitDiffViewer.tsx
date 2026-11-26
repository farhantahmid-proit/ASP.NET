import { useMemo } from 'react'
import { parseUnifiedDiffToSideBySide } from '@/utils/side-by-side-diff.util'

export interface CommitDiffViewerProps {
  diff: string
  additions?: number
  deletions?: number
}

export function CommitDiffViewer({ diff }: CommitDiffViewerProps) {
  const parsedFiles = useMemo(() => parseUnifiedDiffToSideBySide(diff), [diff])

  return (
    <div className="sbs-diff-viewer" role="region" aria-label="Side-by-side visual code diff">
      {parsedFiles.length === 0 ? (
        <div className="sbs-empty-state">No code diff lines available for this commit.</div>
      ) : (
        parsedFiles.map((file) => (
          <section
            key={file.id}
            className="sbs-file-block"
            aria-label={`Changes in ${file.filePath}`}
          >
            <header className="sbs-file-header">
              <div className="sbs-file-header__left">
                <span className="sbs-file-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 16 16"
                    width={15}
                    height={15}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path
                      d="M4 2.2h5.2L12.8 5.8v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1z"
                      strokeLinejoin="round"
                    />
                    <path d="M9 2.3v3.6h3.6" strokeLinejoin="round" />
                  </svg>
                </span>
                <code className="sbs-file-path">{file.filePath}</code>
              </div>
              <div className="sbs-file-stats" aria-label="File diff line statistics">
                <span className="sbs-stat sbs-stat--add">+{file.additions}</span>
                <span className="sbs-stat sbs-stat--del">-{file.deletions}</span>
              </div>
            </header>

            <div className="sbs-column-labels" aria-hidden="true">
              <div className="sbs-column-label sbs-column-label--before">Original</div>
              <div className="sbs-column-label sbs-column-label--after">Updated</div>
            </div>

            <div className="sbs-grid-scroll">
              <table className="sbs-table">
                <colgroup>
                  <col className="sbs-col-ln" />
                  <col className="sbs-col-sign" />
                  <col className="sbs-col-code" />
                  <col className="sbs-col-ln" />
                  <col className="sbs-col-sign" />
                  <col className="sbs-col-code" />
                </colgroup>
                <tbody>
                  {file.rows.map((row, rowIndex) => {
                    if (row.kind === 'hunk') {
                      return (
                        <tr key={`${file.id}-h-${rowIndex}`} className="sbs-row sbs-row--hunk">
                          <td className="sbs-hunk-cell" colSpan={6}>
                            <code>{row.hunkHeader}</code>
                          </td>
                        </tr>
                      )
                    }
                    if (!row.left || !row.right) return null

                    const leftCellClass =
                      row.left.type === 'del'
                        ? ' sbs-cell--del sbs-line--del'
                        : row.left.type === 'empty'
                          ? ' sbs-cell--empty'
                          : ''
                    const rightCellClass =
                      row.right.type === 'add'
                        ? ' sbs-cell--add sbs-line--add'
                        : row.right.type === 'empty'
                          ? ' sbs-cell--empty'
                          : ''

                    return (
                      <tr key={`${file.id}-p-${rowIndex}`} className="sbs-row">
                        <td className={`sbs-ln sbs-ln--left${leftCellClass}`}>
                          {row.left.lineNumber ?? ''}
                        </td>
                        <td className={`sbs-sign sbs-sign--left${leftCellClass}`} aria-hidden="true">
                          {row.left.type === 'del' ? '-' : ''}
                        </td>
                        <td className={`sbs-code sbs-code--left${leftCellClass}`}>
                          {row.left.type !== 'empty' && (
                            <span className="sbs-code-text">
                              {row.left.segments.map((seg, segIdx) =>
                                seg.changed ? (
                                  <mark key={segIdx} className="sbs-mark sbs-mark--del">
                                    {seg.text}
                                  </mark>
                                ) : (
                                  <span key={segIdx}>{seg.text}</span>
                                ),
                              )}
                            </span>
                          )}
                        </td>

                        <td className={`sbs-ln sbs-ln--right${rightCellClass}`}>
                          {row.right.lineNumber ?? ''}
                        </td>
                        <td
                          className={`sbs-sign sbs-sign--right${rightCellClass}`}
                          aria-hidden="true"
                        >
                          {row.right.type === 'add' ? '+' : ''}
                        </td>
                        <td className={`sbs-code sbs-code--right${rightCellClass}`}>
                          {row.right.type !== 'empty' && (
                            <span className="sbs-code-text">
                              {row.right.segments.map((seg, segIdx) =>
                                seg.changed ? (
                                  <mark key={segIdx} className="sbs-mark sbs-mark--add">
                                    {seg.text}
                                  </mark>
                                ) : (
                                  <span key={segIdx}>{seg.text}</span>
                                ),
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  )
}
