/**
 * 股票标识：设计稿 F 里每一行股票都是「首字头像 + 名称 + 红色标签」三段。
 *
 * - 头像是名称首字的圆角方块，沪市蓝、深市绿（和稿子 F 的 `.badge` / `.badge.sz` 同色）；
 * - 标签是红底红字的胶囊（稿子 F 的 `.tag`），放一行里最该被一眼看到的信息：
 *   涨停池是连板数，竞价是昨日连板，龙虎榜是上榜原因，自选/持仓是用户备注。
 */
type StockIdentityProps = {
  name: string;
  /** 代码，如 600519；空字符串表示这一行不展示代码 */
  code?: string;
  /** 主标签文字；null / 空串表示没有标签 */
  tag?: string | null;
  /**
   * 涨停标识（「涨停」/「N 连板」）。和备注同时存在时备注是主标签（红），
   * 涨停标识用蓝色副标签跟在后面。
   */
  limitUpTag?: string | null;
  /** 头像方块里的首字；默认取 name 的首字（本地名和行情名不同时可单独指定） */
  avatarText?: string;
};

/** 沪市代码（6 开头）用蓝色头像，其余（深市 0/3、北交所 4/8）用绿色 */
export const isShanghaiSymbol = (symbol: string): boolean => symbol.startsWith('6');

const StockIdentity = ({
  name,
  code = '',
  tag = null,
  limitUpTag = null,
  avatarText,
}: StockIdentityProps) => (
  <span className="stock-identity">
    <span
      className={`stock-identity__avatar${isShanghaiSymbol(code) ? '' : ' stock-identity__avatar--sz'}`}
      aria-hidden="true"
    >
      {(avatarText ?? name).slice(0, 1) || '—'}
    </span>
    <span className="stock-identity__text">
      <span className="stock-identity__name">
        {name}
        {/* title 兜底：窄列里标签会被省略号截断，悬停仍能看到全称 */}
        {tag ? (
          <span className="stock-tag" title={tag}>
            {tag}
          </span>
        ) : null}
        {limitUpTag ? (
          /* 有备注时涨停标识是副标签（蓝），没备注时它就是主标签（红） */
          <span
            className={`stock-tag${tag ? ' stock-tag--secondary' : ''}`}
            title={limitUpTag}
          >
            {limitUpTag}
          </span>
        ) : null}
      </span>
      {code ? <span className="stock-identity__code">{code}</span> : null}
    </span>
  </span>
);

export { StockIdentity };
export type { StockIdentityProps };
