import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './Nanchang.css'

// 素材图集（public/nanchang，来源：用户上传的手账风南昌攻略图）
const GALLERY = [
  { src: '/nanchang/nanchang-06.jpg', title: 'Day1 手写攻略 · 寻味老城', desc: '大士院 → 八一起义纪念馆 → 万寿宫 → 珠宝街 → 滕王阁夜景' },
  { src: '/nanchang/nanchang-05.jpg', title: 'Day2 手写攻略 · 历史与现代交织', desc: '江西省博物馆 → 红谷滩商圈 → 秋水广场 → 南昌之星摩天轮' },
  { src: '/nanchang/nanchang-04.jpg', title: 'Day3 手写攻略 · 地标打卡', desc: '八一广场 → 八一起义纪念塔 → 江西省美术馆' },
  { src: '/nanchang/nanchang-03.jpg', title: '景点信息一览', desc: '门票价格与预约情况速查表' },
  { src: '/nanchang/nanchang-02.jpg', title: '交通指南', desc: '机场 / 火车站抵达方式 + 市内交通' },
  { src: '/nanchang/nanchang-01.jpg', title: '住宿指南', desc: '八一广场 / 滕王阁 / 红谷滩 / 绳金塔 / 万寿宫住宿对比' },
  { src: '/nanchang/nanchang-07.jpg', title: '三板块游玩地图', desc: '老城、红谷滩、文化场馆三大片区分布' },
  { src: '/nanchang/nanchang-12.jpg', title: '景点分布地图', desc: '各景点位置与通勤时间参考' },
  { src: '/nanchang/nanchang-11.jpg', title: '实拍 Day1', desc: '八一广场 → 江西美术馆 → 珠宝街 / 万寿宫' },
  { src: '/nanchang/nanchang-10.jpg', title: '实拍 · 滕王阁与美食', desc: '八一纪念馆 → 滕王阁夜景 → T16 购物中心' },
  { src: '/nanchang/nanchang-09.jpg', title: '实拍 Day2', desc: '大士院过早 → 佑民寺 → 羊子巷' },
  { src: '/nanchang/nanchang-08.jpg', title: '实拍 · 夜游', desc: '南昌之星 → 秋水广场喷泉 → 蛤蟆街夜宵' },
]

const SPOTS = [
  { name: '滕王阁', tag: '江南三大名楼', ticket: '50r · 背诵《滕王阁序》免门票', desc: '「落霞与孤鹜齐飞，秋水共长天一色」。19:00 亮灯后夜景绝美，北园免费可拍全景，登阁俯瞰一江两岸。' },
  { name: '八一起义纪念馆', tag: '红色记忆', ticket: '免费 · 提前1-3天预约', desc: '军旗升起的地方，铭记 1927 年的红色历史，与珠宝街、万寿宫相邻，建议安排在同一个半天。' },
  { name: '八一广场', tag: '城市地标', ticket: '免费 · 免预约', desc: '南昌核心地标，八一起义纪念塔矗立广场中央，每月 1 日有升旗仪式，地铁 1/2 号线直达。' },
  { name: '万寿宫历史文化街区', tag: '历史街区', ticket: '免费 · 免预约', desc: '古建筑与潮流小店相遇，「南昌」花墙必打卡，周边老字号小吃扎堆，晚上更热闹。' },
  { name: '大士院', tag: '老南昌味道', ticket: '免费 · 免预约', desc: '老南昌最纯正的早晨，1 块钱的白糖糕配 3 块钱的拌粉瓦罐汤，老巷文化墙也很出片。' },
  { name: '珠宝街', tag: '小吃一条街', ticket: '免费 · 免预约', desc: '南昌味道 yyds，水煮、各类特色小吃集中地，别忘了打卡周杰伦《晴天》歌词墙。' },
  { name: '绳金塔', tag: '千年古塔', ticket: '免费 · 免预约', desc: '南昌的文化符号，塔下美食街能尝到地道瓦罐汤、拌粉、白糖糕。' },
  { name: '秋水广场', tag: '夜景喷泉', ticket: '免费 · 免预约', desc: '音乐喷泉每天 19:30、20:30 各一场（约 20 分钟），建议 19:30 前占位，与滕王阁隔江相望。' },
  { name: '南昌之星摩天轮', tag: '网红地标', ticket: '50r · 免预约', desc: '总高 160 米，国内最高的摩天轮之一，60 个太空舱俯瞰赣江两岸，末班 22:00 别错过。' },
  { name: '江西省博物馆', tag: '文化场馆', ticket: '免费 · 提前1-3天预约 · 周一闭馆', desc: '镇馆之宝青铜虎、元青花瓷瓶，还有海昏侯墓出土金器，留足 2-3 小时细逛。' },
  { name: '海昏侯博物馆', tag: '考古顶流', ticket: '75r · 建议提前预约', desc: '「含金量」最高的博物馆，马蹄金、金饼堆成山，距市区较远建议单独安排半天。' },
  { name: '绿地双子塔', tag: '城市天际线', ticket: '免费 · 免预约', desc: '303 观光厅俯瞰全城，红谷滩 CBD 地标，夜晚灯光秀很出片。' },
]

const WALLS = [
  { name: '万寿宫「南昌」花墙', desc: '鲜花拼成的南昌二字，街区人气打卡点 No.1' },
  { name: '珠宝街晴天墙', desc: '周杰伦《晴天》歌词墙，杰迷必拍' },
  { name: '大士院老巷文化墙', desc: '老巷烟火气 + 城市记忆彩绘' },
  { name: '滕王阁序灯笼墙', desc: '滕王阁北扩片区，国风灯笼写满千古名篇' },
]

const FOODS = [
  { name: '瓦罐汤', desc: '南昌人的早餐标配，文火慢煨，配拌粉一绝' },
  { name: '南昌拌粉', desc: '3 块钱的快乐，米粉爽滑，辣得过瘾' },
  { name: '白糖糕', desc: '大士院 1 块钱一个，外酥里糯的儿时味道' },
  { name: '水煮', desc: '珠宝街必吃，南昌版麻辣烫，夜宵顶流' },
  { name: '藜蒿炒腊肉', desc: '鄱阳湖藜蒿配腊肉，赣菜下饭担当' },
  { name: '老三样', desc: '万寿宫排队王，辣是真的辣，备好酸奶再战' },
  { name: '打平伙 / 堂瓦里', desc: '本地人扎堆的赣菜馆，家常味下饭又实在' },
  { name: '蛤蟆街夜宵', desc: '夜宵一条街，烤串小龙虾，吃完回程刚刚好' },
]

function Nanchang() {
  const [viewer, setViewer] = useState(null) // 当前灯箱图片索引
  const closeBtnRef = useRef(null)

  useEffect(() => {
    document.title = '南昌旅游介绍 - 天下英雄城'
    return () => { document.title = 'React App' }
  }, [])

  // 灯箱打开时焦点落入关闭按钮，Esc 关闭
  useEffect(() => {
    if (viewer === null) return
    closeBtnRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') setViewer(null)
      if (e.key === 'ArrowRight') setViewer((v) => (v + 1) % GALLERY.length)
      if (e.key === 'ArrowLeft') setViewer((v) => (v - 1 + GALLERY.length) % GALLERY.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="nc-page">
      <div className="nc-top">
        <Link to="/index.html" className="nc-back">← 返回首页</Link>
      </div>

      <header className="nc-hero">
        <p className="nc-hero-kicker">物华天宝 · 人杰地灵</p>
        <h1>天下英雄城 · 南昌</h1>
        <p className="nc-hero-sub">
          老城烟火气 + 红色记忆 + 历史文化 + 江风夜景，就是南昌的浪漫。
          这座建城两千多年的城市，值得慢慢发现。
        </p>
        <ul className="nc-hero-tags" aria-label="城市关键词">
          <li>红色记忆</li>
          <li>老城烟火气</li>
          <li>江风夜景</li>
          <li>历史文化名城</li>
        </ul>
      </header>

      <main>
        <section className="nc-section" aria-labelledby="nc-itinerary">
          <h2 id="nc-itinerary">三日行程推荐</h2>
          <div className="nc-days">
            <article className="nc-day">
              <h3><span className="nc-day-badge">Day 1</span> 寻味老城</h3>
              <p className="nc-day-route">大士院 → 八一起义纪念馆 → 万寿宫 → 珠宝街 → 滕王阁夜景</p>
              <ul>
                <li>上午：大士院过早，白糖糕 + 瓦罐汤，逛老街区（约 2h）</li>
                <li>下午：八一起义纪念馆（约 2h），步行 15 分钟到万寿宫闲逛拍照</li>
                <li>晚上：珠宝街吃水煮，赣江边看滕王阁夜景（约 1h）</li>
              </ul>
            </article>
            <article className="nc-day">
              <h3><span className="nc-day-badge">Day 2</span> 历史与现代交织</h3>
              <p className="nc-day-route">江西省博物馆 → 红谷滩商圈 → 秋水广场 → 南昌之星</p>
              <ul>
                <li>上午：江西省博物馆看青铜虎与元青花瓷瓶（约 3h）</li>
                <li>下午：红谷滩商圈逛吃，傍晚赣江边漫步看落日</li>
                <li>晚上：19:30 秋水广场音乐喷泉，随后南昌之星俯瞰全城夜景</li>
              </ul>
            </article>
            <article className="nc-day">
              <h3><span className="nc-day-badge">Day 3</span> 地标打卡</h3>
              <p className="nc-day-route">八一广场 → 八一起义纪念塔 → 江西省美术馆</p>
              <ul>
                <li>上午：八一广场打卡纪念塔，感受庄严（约 1h）</li>
                <li>下午：步行 5 分钟到江西省美术馆看展拍照（约 2h），午餐吃地道赣菜</li>
                <li>晚上：周边商场买伴手礼，愉快返程</li>
              </ul>
            </article>
          </div>
        </section>

        <section className="nc-section" aria-labelledby="nc-spots">
          <h2 id="nc-spots">景点速览</h2>
          <div className="nc-spots">
            {SPOTS.map((s) => (
              <article className="nc-spot" key={s.name}>
                <div className="nc-spot-head">
                  <h3>{s.name}</h3>
                  <span className="nc-spot-tag">{s.tag}</span>
                </div>
                <p className="nc-spot-ticket">{s.ticket}</p>
                <p className="nc-spot-desc">{s.desc}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="nc-section" aria-labelledby="nc-walls">
          <h2 id="nc-walls">网红打卡墙</h2>
          <div className="nc-foods">
            {WALLS.map((w) => (
              <div className="nc-food" key={w.name}>
                <h3>{w.name}</h3>
                <p>{w.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="nc-section" aria-labelledby="nc-food">
          <h2 id="nc-food">必吃美食</h2>
          <div className="nc-foods">
            {FOODS.map((f) => (
              <div className="nc-food" key={f.name}>
                <h3>{f.name}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="nc-section" aria-labelledby="nc-traffic">
          <h2 id="nc-traffic">交通与住宿</h2>
          <div className="nc-two-col">
            <div className="nc-panel">
              <h3>抵达与市内交通</h3>
              <ul>
                <li><strong>昌北国际机场</strong>：距市中心约 28 公里，机场大巴、地铁 1 号线可达市区</li>
                <li><strong>南昌站</strong>：老火车站，离滕王阁、万寿宫历史街区近</li>
                <li><strong>南昌西站</strong>：高铁站，地铁 2 号线、4 号线直达市区</li>
                <li><strong>市内</strong>：地铁覆盖主要景点（06:00-22:00），公交普通车 2 元，网约车方便</li>
              </ul>
            </div>
            <div className="nc-panel">
              <h3>住哪里</h3>
              <ul>
                <li><strong>八一广场</strong>：交通枢纽，离各景点都近，适合初次来南昌</li>
                <li><strong>滕王阁附近</strong>：近距离欣赏滕王阁夜景与赣江风光</li>
                <li><strong>红谷滩新区</strong>：现代化区域，近南昌之星、秋水广场，价格偏高</li>
                <li><strong>绳金塔 / 万寿宫</strong>：美食扎堆，老城区烟火气浓</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="nc-section" aria-labelledby="nc-gallery">
          <h2 id="nc-gallery">手绘攻略图集</h2>
          <p className="nc-gallery-tip">点击图片可放大查看，← → 切换，Esc 关闭。</p>
          <div className="nc-gallery">
            {GALLERY.map((g, i) => (
              <button
                type="button"
                className="nc-gallery-item"
                key={g.src}
                onClick={() => setViewer(i)}
                aria-label={`查看大图：${g.title}`}
              >
                <img src={g.src} alt={g.title} loading="lazy" />
                <span className="nc-gallery-caption">
                  <strong>{g.title}</strong>
                  <em>{g.desc}</em>
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer className="nc-footer">
        <p>小贴士：背诵《滕王阁序》可免门票；省博物馆 / 美术馆 / 八一起义纪念馆提前 1-3 天预约、周一闭馆；秋水广场喷泉 19:30 / 20:30 各一场；南昌之星摩天轮末班 22:00；赣菜口味偏辣，点菜可提醒少辣；部分景点需刷身份证入园，记得带上身份证。</p>
      </footer>

      {viewer !== null && (
        <div
          className="nc-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`攻略大图：${GALLERY[viewer].title}`}
          onClick={() => setViewer(null)}
        >
          <button
            type="button"
            className="nc-lightbox-close"
            ref={closeBtnRef}
            onClick={() => setViewer(null)}
            aria-label="关闭大图"
          >
            ×
          </button>
          <img
            src={GALLERY[viewer].src}
            alt={GALLERY[viewer].title}
            onClick={(e) => e.stopPropagation()}
          />
          <p className="nc-lightbox-caption">{GALLERY[viewer].title}（{viewer + 1} / {GALLERY.length}）</p>
        </div>
      )}
    </div>
  )
}

export default Nanchang
