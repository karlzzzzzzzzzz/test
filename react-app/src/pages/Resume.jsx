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
              <a href="https://github.com/karlzzzzzzzzzz/test" target="_blank" rel="noopener noreferrer">个人主页</a>
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
              <span>籍贯：浙江温州</span>
              <span>学历：本科</span>
              <span>工作经验：5 年</span>
            </div>
          </section>

          {/* ===== 教育经历 ===== */}
          <section className="sec">
            <h2>教育经历</h2>
            <div className="rows">
              {/* <div className="row4">
                <span>2016.9 至 2019.7</span>
                <span>宁波职业技术学院</span>
                <span>电子信息工程学院</span>
                <span>计算机网络</span>
              </div> */}
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
              <li>浙江省 ACM 全国大学生程序设计竞赛 小组铜奖</li>
              <li>宁波市蓝鸥杯程序设计竞赛 小组银奖</li>
              <li>大学生英语四级</li>
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
                掌握React全家桶（react-router、react-redux、Hooks）能独立完成中后台SPA开发
              </li>
              <li>
                掌握Rax App开发支付宝小程序开发、测试、打包、上架全流程。
              </li>
              <li>
                掌握Magix单页面应用前端架构，Magix-gallery配套组件库，MM-CLI配套命令行工具，Magix微应用落地及Magix-brix组件模块化构建
              </li>
              <li>
                熟练使用Fusion、ICE（Vite）、Formily、MDD（JSON Schema）等低代码中后台方案使用及开发调试
              </li>
              <li>
                熟练使用Git、Webpack、Vite、axios等工程化工具；熟悉 Postman、Charles、ARMS埋点等调试监控手段
              </li>
              <li>
              了解AI Agent开发基础知识LLM、Transformer、RAG、Prompt Engineering等。了解Vue全家桶及 Node.js、MySQL、MongoDB、Python、Java、C++基础。
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
                  项目一：金融贷支付宝小程序（React，Rax App）
                </h3>
                <ul className="dot">
                  <li>
                    <strong>项目介绍：</strong>
                    由菜鸟网络联合银行等金融机构，为开发优质平台经销商专门打造的大数据供应链信用贷款支付宝小程序。
                  </li>
                  <li>
                    <strong>项目职责：</strong>
                    小程序端负责授信、支用、还款流程表单页面开发与后续维护.
                  </li>
                  <li>
                    <strong>技术描述：</strong>
                    使用 Rax App 框架，实现支付宝小程序项目架构；Rax 语法层面以 React 为标准，可以使用 Hooks、Context 等80%以上支持度的 React App，因此开发多以 React 函数组件 + hooks 编写组件；
                    保证不同移动端组件样式兼容性；封装小程序原生request 请求拦截、ARMS数据埋点、按需加载、性能优化；
                    接入支付宝地址库，人脸识别，位置/网络/设备获取等原生API；使用支付宝开发者工具进行项目的打包发版。
                  </li>
                  <li>
                    <strong>项目难题（双端问题）：</strong>
                    1、IOS特定版本下下，输入框光标错位（参考文档：https://www.volcengine.com/article/583034）
                    总结：IPHON8，IOS11环境下 第一个遇到的问题是键盘弹起时导致的光标错位。额外的触发条件需要是长页面（可滚动状态），解决方案是输入框获得焦点时，临时禁用滚动容器的滚动。
                    解决完第一个问题以后又出现第二个问题，光标移位变成了小距离的移位。原因是输入框的line-height和font-size不匹配。组件设计时用了line-height属性来控制高度，所以和font-size不匹配。最后在组件中统一了两个属性(改用padding来控制高度)。
                    2、ios圆角属性失效（参考文档：https://blog.51cto.com/u_15301829/4568179，https://blog.csdn.net/Min_nna/article/details/134369404）
                    总结：ios手机会在transform的时候导致border-radius失效。解决方法：在使用动画效果带transform的元素的上一级div元素的css加上下面语句：
                    transform: rotate(0deg);-webkit-transform: rotate(0deg);
                    3、在ios手机上使用new Date()格式化时间时，时间格式不能是'2021-03-17 12:00:00' 带'-'的，必须先进行转换，如 time = ('2021-03-17 12:00:00').replace(/-/g,'/'); time= "2021/03/17 12:00:00"
                    4、支付宝小程序做跳转时，需要注意冷热启动的兼容（两个方式对应生命周期不同）（参考文档：https://zhuanlan.zhihu.com/p/662906724）
                  </li>
                </ul>
              </div>
              <div>
                <h3>
                  项目二：租赁管理系统，仓储管系统（React，ICE，Formily，MDD，Schema）
                </h3>
                <ul className="dot">
                  <li>
                    <strong>项目介绍：</strong>
                    多款商业化交付项目，其中包括融资租赁后台管理系统、物流仓储管理系统等。
                  </li>
                  <li>
                    <strong>项目职责：</strong>
                    从项目初期 PRD 评审，技术评审，开发，联调，测试，UAT 到交付落地的所有技术支持。
                  </li>
                  <li>
                    <strong>技术描述：</strong>
                    使用基于 React 的研发解决方案 ICE（Vite）搭建项目，配合约定式路由。
                    基于 WOTS 项目中大量的 FTP 页面，使用了模型驱动开发（MDD）套件配合前后端接口统一规范套件，几乎零代码生成 FTP 页面。
                    表单框架使用 Formily，基于延续 Mobx 的@formily/reactive 实现表单进去渲染，配合 JSON Schame 及@formily/react，轻松解决表单构建及一对一，一对多，多对多的表单联动交互。
                  </li>
                  <li>
                    <strong>项目目标及产出：</strong>
                    经过调研发现项目中 70% 左右是纯表单 和 FTP页面。因此我计了通过数据模型快速生成标准中后台界面的低代码流程。核心逻辑是根据页面模板解析接口文档中的入参和出参，根据参数的数据类型，渲染对应的 cn-ui 标准组件，完成页面生成。
                    目前 L3 模型驱动的低代码能力在物流科技多个项目中使用，由后端同学全栈输出 919+ 页面，全流程无需前端参与，平均单页面的研发时长约为 1H，同时前端答疑率小于 10%，
                    主要职责schema可视化配置页面开发及性能优化。页面主要以表单形式展示可配置项，可支持拖拽式配置。
                    拖拽功能参考react-dnd（学习成本较高），react-sortable-hoc（文档较少）组件库，最终使用HTML5的拖放API，封装了一个简易的单项拖拽组件（参考文档：https://zhuanlan.zhihu.com/p/430177180）。
                  </li>
                </ul>
              </div>
              <div>
                <h3>项目三：阿里妈妈运营工作台系列项目（Magix，Magix3，Brix，微前端）</h3>
                <ul className="dot">
                  <li>
                    <strong>项目介绍：</strong>
                    阿里妈妈运营工作台系列项目包含：op（阿里妈妈-运营工作台）历史平台、mmcrm-op 业务流程重构平台、ai-crm
                    智能 CRM 平台及东风（udradar）、心流（iFlowCLI）。
                  </li>
                  <li>
                    <strong>项目职责：</strong>
                    op 历史平台页面功能需求维护。梳理历史业务逻辑，结合新的运营思路重新构建mmcrm-op新版运营工作台，负责项目整体架构设计与开发及后续维护；
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
                    基于Magix区块化理念，使用配套组件库、RAP接口规范及命令行工具快速构建项目。结合业务需求，创建模块化新策略构建模式，将新类型需求落地开发时长降低50%，同时提升页面维护，测试效率。
                    特殊微前端场景下通过iframe桥接magi互嵌项目，通过webSocket与宿主平台通信，桥接方案降低了后续页面模块接入成本；
                    重构 OSS 上传组件支持文件分片与批量上传，提升大文件并发上传稳定性；diff2html渲染文件diff，xterm渲染shell终端，react-markdown渲染，tailwindcss配合css变量做移动端适配。
                  </li>
                  <li>
                    <strong>项目难点：</strong>
                    1、接手项目时，发现产品整体代码主要是面相过程开发，且文档及开发备注极少。功能较为混乱，扩展性较差，维护成本高。在平台迁移的过程中，和产品进行需求沟通，对产品进行了历史逻辑的梳理一级整体重构。主体改为函数式编程，抽离出公共组件及公用逻辑函数，保持模块与函数无副作用，增加了产品的可扩展性和稳定性。
                    历史平台新增需求大多需要以周来计算，新平台提升至一天以内。同时功能模块的解耦也提升了单测的可靠性，降低了测试成本。另一侧产品主要页面为列表数据展示及基本表单填写，重构过程中通过和后端设计的接口结构规范，仅需数据库字段更新，即可满足页面字段的增删改需求。项目落地后基本无需前端维护。
                    2、使用阿里云对象存储OSS封装上传组件，基于H5拖放API实现文件拖拽上传，使用promise.allSettled解决并发上传失败问题，使用分片上传解决大文件上传超时问题。透出beforeUpload、onProgress、onSuccess、onError、onChange等回调函数，方便后续业务逻辑的扩展。
                    3、项目接入Ai skill以后，需要轮询ai返回结果，使用setInterval实现轮询，同时在离开页面及超出轮询时长以后，清除计时器。后续发现此页面可能会出现异步队列堵塞问题，导致计时器不准确，改为时间戳计算轮询时长。
                  </li>
                </ul>
              </div>
              {/* <div>
                <h3>
                  项目四：金融小二管理后台（React，Fusion，axios，Walle）
                </h3>
                <ul className="dot">
                  <li>
                    <strong>项目介绍：</strong>
                    运维小二用于处理各类金融产品所对应问题所设计的提效降本运维工具的 Iframe 微前端平台
                  </li>
                  <li>
                    <strong>项目职责：</strong>
                    使用 React 框架，React-router 搭建路由，配合 funsion 组件库完成新增功能页面开发。使用 Walle 框架及组件库维护历史页面功能。
                  </li>
                  <li>
                    <strong>技术描述：</strong>
                   项目作为一个使用 iFrame 及自定义消息传递机制大搭建的微前端应用。存在 walle，react 等多中项目。其中 react 项目做为一个后台管理的 SPA，包括黑白名单，客户信息管理，角色权限配置等模块。采用模块化，组件化工程化的模块开发满足增长需求。
                  </li>
                </ul>
              </div> */}
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
