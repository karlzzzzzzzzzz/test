import { useEffect } from 'react'
import qrImg from '../assets/resume/qr.png'
import './Resume.css'

function Resume() {
  useEffect(() => {
    const prevTitle = document.title
    document.title = '个人简历 - 邵凯'
    return () => {
      document.title = prevTitle
    }
  }, [])

  return (
    <div className="resume-page">
      <div className="resume-sheet">
        {/* ===== 顶部（Grid 区域：info / qr / meta） ===== */}
        <header className="hero">
          <div className="hero-bg"></div>

          <div className="hero-info">
            <h1>个人简历</h1>
            <div className="hero-contact">
              <p className="en">MOBILE：( +86 ) 137-7771-5532</p>
              <p className="en">E-MAIL：k13777715532@163.com</p>
            </div>
          </div>

          <div className="qr">
            <img src={qrImg} alt="二维码" />
            <p className="goal">
              求职目标：<strong>前端工程师</strong>
            </p>
          </div>

          <p className="hero-meta">Address：杭州市余杭区余杭街道</p>
        </header>

        <main>
          {/* ===== 个人信息 ===== */}
          <section className="sec">
            <h2>个人信息</h2>
            <div className="grid3">
              <span>姓名：邵凯</span>
              <span>性别：男</span>
              <span>年龄：24</span>
              <span>民族：汉</span>
              <span>籍贯：浙江温州</span>
              <span>工作经验：5 年</span>
            </div>
          </section>

          {/* ===== 教育经历 ===== */}
          <section className="sec">
            <h2>教育经历</h2>
            <div className="rows">
              <div className="row4">
                <span>2016.9 至 2019.7</span>
                <span>宁波职业技术学院</span>
                <span>电子信息工程学院</span>
                <span>计算机网络</span>
              </div>
              <div className="row4">
                <span>2019.9 至 2021.7</span>
                <span>台州学院</span>
                <span>大数据学院</span>
                <span>计算机科学与技术</span>
              </div>
            </div>
          </section>

          {/* ===== 技术获奖 ===== */}
          <section className="sec">
            <h2>技术获奖</h2>
            <ul className="dot">
              <li>浙江省 ACM 全国大学生程序设计竞赛 小组铜奖（专科组）</li>
              <li>宁波市蓝鸥杯程序设计竞赛 小组银奖（专科组）</li>
            </ul>
          </section>

          {/* ===== 技术简介 ===== */}
          <section className="sec">
            <h2>技术简介</h2>
            <ul className="dot">
              <li>
                掌握 HTML、CSS、JavaScript 前端基础，精通页面布局与 H5、C3
                新特性，熟悉 Less、Sass 及移动端适配
              </li>
              <li>
                掌握 React 全家桶（react-router、react-redux、Hooks），能独立完成中后台
                SPA 开发
              </li>
              <li>
                掌握 Rax App
                开发支付宝小程序，熟悉开发、测试、上架全流程，有人脸识别、地址库、设备能力等原生
                API 接入经验
              </li>
              <li>
                掌握 Magix2 / Magix3 区块化框架及
                magix-brix，熟练使用 iframe +
                自定义消息机制进行微前端集成与桥接通信
              </li>
              <li>
                熟练使用 Fusion、ICE（Vite）、Formily、MDD、JSON Schema
                等中后台方案，可近乎零代码生成表单页并实现复杂表单联动
              </li>
              <li>
                熟练使用 Git、Webpack、Vite、axios
                等工程化工具，熟悉 Postman、Charles、ARMS
                埋点等调试监控手段；了解 Vue 全家桶及 Node.js、MySQL、MongoDB 基础
              </li>
            </ul>
          </section>

          {/* ===== 工作经历 ===== */}
          <section className="sec">
            <h2>工作经历</h2>
            <div className="rows">
              <div className="row3">
                <span>2021.10 至 2023.5</span>
                <span>杭州博彦科技有限公司(菜鸟)</span>
              </div>
              <div className="row3">
                <span>2023.7 至 2026.9</span>
                <span>德科人力资源有限公司(阿里妈妈)</span>
              </div>
            </div>
          </section>

          {/* ===== 项目经验 ===== */}
          <section className="sec">
            <h2>项目经验</h2>
            <div className="proj">
              <div>
                <h3>
                  项目一：菜鸟网络金融科技系列项目（React，Rax，Walle，ICE，Formily）
                </h3>
                <ul className="dot">
                  <li>
                    <strong>项目介绍：</strong>
                    菜鸟网络联合银行等金融机构共同打造的金融科技系列项目，包含：面向品牌经销商的大数据供应链信用贷款支付宝小程序（金融贷）、运维小二处理金融产品问题的
                    iframe 微前端提效平台（金融小二管理后台），以及融资租赁、物流仓储等多款商业化中后台交付系统。
                  </li>
                  <li>
                    <strong>项目职责：</strong>
                    小程序端负责授信、支用、还款流程表单页面开发与后续维护；管理后台负责黑白名单、客户信息管理、角色权限配置等
                    SPA 模块的新增与历史页面维护；中后台项目从 PRD
                    评审、技术评审、开发、联调、测试到 UAT
                    交付提供全流程技术支持。
                  </li>
                  <li>
                    <strong>相关技术：</strong>
                    React 全家桶（React-router、Redux、Hooks），Rax
                    App，Fusion，Walle，ICE（Vite），Formily，MDD，JSON
                    Schema，axios，Webpack。
                  </li>
                  <li>
                    <strong>技术描述：</strong>
                    小程序端基于 Rax App 搭建，以 React 函数组件 + Hooks
                    编写，封装原生 request
                    请求拦截、按需加载与性能优化，接入支付宝地址库、人脸识别、位置/网络/设备等原生
                    API；微前端平台基于 iframe +
                    自定义消息传递机制集成 Walle、React
                    等多类子应用，采用 React + Fusion + ES6 + Webpack
                    模块化组件化开发；中后台基于 ICE
                    约定式路由，使用模型驱动开发（MDD）套件配合接口统一规范近乎零代码生成表单页，表单层采用
                    Formily（@formily/reactive + JSON Schema）
                    实现一对一、一对多、多对多联动交互。
                  </li>
                </ul>
              </div>

              <div>
                <h3>项目二：阿里妈妈运营工作台系列项目（Magix，Magix3，Brix，微前端）</h3>
                <ul className="dot">
                  <li>
                    <strong>项目介绍：</strong>
                    Magix
                    是区块化管理框架，一个复杂站点可拆分为多个页面，复杂页面再拆分为多个区块进行维护，方便区块的拆分、复用与调试。参与
                    op（阿里妈妈-运营工作台）旧平台、mmcrm-op 重构平台、ai-crm
                    智能 CRM 平台、东风（udradar）、心流（iFlow
                    CLI）等多个平台的前端开发。
                  </li>
                  <li>
                    <strong>项目职责：</strong>
                    op 旧平台基于 Magix2 框架管理活动及营销数据，开发列表及表单创建类页面；mmcrm-op
                    使用新版 Magix3 框架结合运营流程优化思路重构历史运营平台，项目以微前端方式嵌入并同时挂载多个同平台功能；负责
                    OSS 上传组件重构（支持分片、批量上传）；数据看板通过 iframe 嵌入 fib
                    链接并接入 chart 图表；页面轮询 AI
                    结果时使用时间戳做判定；ai-crm 智能 CRM 平台通过 Magix
                    桥接 iframe 嵌入；东风（udradar）使用 magix-brix 开发 ADC
                    节点配置页面及组件；心流（iFlow CLI）aicoder
                    平台负责移动端适配、GitHub 关联登录、文件 diff、Markdown
                    文本渲染、shell 终端渲染、文件读写渲染等功能。
                  </li>
                  <li>
                    <strong>相关技术：</strong>
                    Magix2 / Magix3，magix-brix，iframe 微前端桥接，OSS
                    分片与批量上传，Chart 图表，时间戳轮询，Markdown 渲染，Shell
                    终端渲染。
                  </li>
                  <li>
                    <strong>技术描述：</strong>
                    基于 Magix
                    区块化理念将页面拆分为独立区块维护，微前端场景下通过 Magix
                    桥接实现 iframe 与宿主平台通信；OSS
                    上传组件重构后支持文件分片与批量上传，提升大文件上传稳定性；AI
                    结果页采用轮询机制并以时间戳判定结果有效性，避免重复渲染；aicoder
                    平台在浏览器端完成 Markdown 文本与 shell
                    终端的渲染及文件读写展示，并完成移动端适配。
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* ===== 自我评价 ===== */}
          <section className="sec">
            <h2>自我评价</h2>
            <ul className="dot">
              <li>具有良好的团队合作精神和沟通组织能力</li>
              <li>自学能力强，逻辑清晰，对新知识接受快</li>
              <li>待人真诚，为人谦虚，遇到问题能够虚心请教</li>
            </ul>
          </section>
        </main>
      </div>
    </div>
  )
}

export default Resume
