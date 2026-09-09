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
              <span>年龄：28</span>
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
                精通HTML、CSS、JavaScript前端基础，H5、C3、ES6 新特性，Less、Sass、tailwindcss及移动端适配
              </li>
              <li>
                掌握React全家桶（react-router、react-redux、Hooks），能独立完成中后台SPA开发
              </li>
              <li>
                掌握Rax App开发支付宝小程序，熟悉开发、测试、上架全流程。有人脸识别、地址库、设备能力等原生API接入经验
              </li>
              <li>
                掌握Magix单页面应用前端架构，Magix-gallery配套组件库，MM-CLI配套命令行工具，Magix微应用落地及Magix-brix组件模块化构建
              </li>
              <li>
                熟练使用Fusion、ICE（Vite）、Formily、MDD、JSON Schema等中后台方案，可近乎零代码生成表单页并实现复杂表单联动
              </li>
              <li>
                熟练使用Git、Webpack、Vite、axios等工程化工具；熟悉 Postman、Charles、ARMS埋点等调试监控手段；了解Vue全家桶及 Node.js、MySQL、MongoDB基础
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
                    阿里妈妈运营工作台系列项目包含：op（阿里妈妈-运营工作台）历史平台、mmcrm-op 业务流程重构平台、ai-crm
                    智能 CRM 平台及东风（udradar）、心流（iFlowCLI）。
                  </li>
                  <li>
                    <strong>项目职责：</strong>
                    op 历史平台页面功能需求维护，梳理历史业务逻辑，结合新的运营思路重新构建mmcrm-op新版运营工作台，负责项目整体架构设计与开发及后续维护；
                    ai-crm 使用微前端嵌入crm-op部分功能，负责具体嵌入方案设计与开发及页面嵌入兼容性改造；
                    东风（udradar）负责重构页面组件，使用 magix-brix 架构开发 ADC 节点配置的组件；
                    心流（iFlow CLI）aicoder 平台，负责移动端适配、GitHub 关联登录、文件 diff、Markdown文本渲染、shell 终端渲染、文件读写渲染等功能开发及维护。
                  </li>
                  <li>
                    <strong>相关技术：</strong>
                    Magix，Magix-gallery，MM-CLI，Magix-brix，微前端，矢量图标iconfont，Chartpark图表，OSS 上传，Markdown 渲染，Shell
                    终端渲染。
                  </li>
                  <li>
                    <strong>技术描述：</strong>
                    基于Magix区块化理念，使用配套组件库、RAP接口规范及命令行工具快速构建项目，特殊微前端场景下通过iframe桥接magi互嵌项目，通过webSocket与宿主平台通信；
                    重构 OSS 上传组件支持文件分片与批量上传，提升大文件上传稳定性；diff2html渲染文件diff，xterm渲染shell终端，react-markdown渲染，tailwindcss配合css变量做移动端适配。
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
