export interface RankEntry {
  id: string;
  name: string;
  /** 次要信息，如所属部门。 */
  meta?: string | undefined;
  /** 右侧读数，如「12 次」。 */
  value: string;
}

const MEDALS = ["gold", "silver", "bronze"] as const;

/**
 * 名次榜卡片：员工排行榜的通用名次展示。
 * 名次徽章只表达顺序，不承担业务语义；红/灰由 tone 决定。
 */
export function RankCard({ title, tone, entries, emptyText = "暂无上榜记录", caption }: {
  title: string;
  tone: "red" | "gray";
  entries: RankEntry[];
  emptyText?: string;
  caption?: string | undefined;
}) {
  return (
    <section className={`dv-rank ${tone}`}>
      <h2>{title}</h2>
      {caption ? <p className="dv-rank-caption">{caption}</p> : null}
      {entries.length === 0
        ? <p className="dv-rank-empty">{emptyText}</p>
        : (
          <ol>
            {entries.map((entry, index) => (
              <li key={entry.id}>
                <span className={`dv-rank-medal ${tone === "red" ? MEDALS[index] ?? "bronze" : ""}`} aria-label={`第 ${index + 1} 名`}>{index + 1}</span>
                <span className="dv-rank-name">{entry.name}{entry.meta ? <> <small>{entry.meta}</small></> : null}</span>
                <span className="dv-rank-value">{entry.value}</span>
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
