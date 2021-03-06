/* eslint react/prop-types: 0 */

/**
 * 应用性入口文件，完全业务性，包含路由
 *
 * 此时发现了抽取预加载链接(路由入口)组件(高阶)的必要性了
 * 此组件主要负责: 接收一个to(url)，此url已在route config中
 * 进行了配置，从而生成数据，组件预加载链接！
 *
 * 现在我们的问题是: 这需要是个高阶组件还是仅仅是个组件即可
 * 如果感觉不到基础组件的痛苦，那我们就用基础组件试试
 */
import React from 'react';
import { Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import Router, { routerConfig } from '../../routes/index';
import Loading from '../Loading';
import LeftNav from '../Nav/LeftNav';
import TopNav from '../Nav/TopNav';
import Footer from '../Footer';
import Style from './index.scss';
import EventEmit from '../../utils/eventCenter';
import '../../styles/global.scss';
import '../../styles/highlight.scss';

const RouteWithSubRoutes = route => (
  <Route
    exact={route.exact}
    strict={route.strict}
    path={route.path}
    render={props => (
      // pass the sub-routes down to keep nesting
      <route.component {...props} routes={route.routes} />
    )}
  />
);

const App = ({ store, serverRouteConf }) => {
  let mainContainer = null;
  let container = null;

  // 组件重渲染，回到顶部事件
  EventEmit.on('backToTop', () => {
    if (!mainContainer) {
      return;
    }
    mainContainer.scrollTo(0, 0);
  });

  // 移动端slide回调
  const mobileSlideCallback = () => {
    if (!container) {
      return;
    }
    let className = container.className;
    if (className.indexOf('side') >= 0) {
      className = className.replace(/(\s)?side(\s)?/, (arg1, arg2, arg3) => (arg2 && arg3 ? ' ' : ''));
    } else {
      className += ' side';
      EventEmit.emit('backToTop');
    }
    container.className = className;
  };

  return (
    <Provider store={store}>
      <Router location={serverRouteConf && serverRouteConf.url}>
        <div className={Style.main_container} ref={(ele) => { container = ele; }}>
          <Loading />
          <div className={Style.main_left}>
            <LeftNav />
          </div>
          <div className={Style.main_right} ref={(ele) => { mainContainer = ele; }}>
            <TopNav mobileSlideCallback={mobileSlideCallback} />
            {
              routerConfig.map(route => (
                <RouteWithSubRoutes key={route.path} {...route} />
              ))
            }
            <Footer />
            <div className={Style.sliceMask} onClick={mobileSlideCallback} role="Button" tabIndex="-1" onKeyDown={mobileSlideCallback} />
          </div>
        </div>
      </Router>
    </Provider>
  );
};

export default App;
