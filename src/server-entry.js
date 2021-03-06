/* eslint react/jsx-filename-extension: 0, guard-for-in: 0 */

/**
 * 服务端渲染入口文件:
 * 仿照Vue ssr: 我们将会在这个文件中导出最终需要打包输出的文件
 *
 * 基于一点: 这里的代码其实都是在外部server调用时进行运行的  打包并不会对业务逻辑有影响
 * 也即，
 *
 * 原则上来说，我觉得我们将服务端入口，我们将其写成一个express的中
 * 间件模式即可
 *
 * 我们更希望的是将这个文件当成一个中间件creator，传入特定的参数(配置)
 *
 * 职责分明(这边可以干啥 && 应该干啥)
 *  构造整个首屏的基础html结构
 *  样式解析插入
 *  webpackJsonp模块化chunk按需加载
 *  meta，搜索引擎相关(header处理)
 *
 * 目前需要解决的问题: 打包输出的是啥 -> 执行上下文会对打包输出做啥
 *  -> 我们又是如何和执行上下文合作来响应请求
 *
 *
 * Dynamically load modules: import()
 *  动态模块加载，前后端的配合问题，后端将模块代码进行类(lazy load)先行注入
 * (当然这只是按需注入啦)
 *
 */
import React from 'react';
import Helmet from 'react-helmet';
import { renderToNodeStream, renderToStaticMarkup } from 'react-dom/server';
import { matchPath } from 'react-router-dom';
import App from './components/app';
import configureStore from './store';
import { mustSSRLoad, routerConfig } from './routes/index';
import generateParams from './action/requestParamsFactory';

const devOutputPath = '/dist/';
const asyncCommonChunks = ['async-common'];
let headInfoMCache = {};

const createStoreAndLoadData = (req, store) => {
  let needLoads = [];
  let preLoadComponent = null;
  Object.assign(needLoads, mustSSRLoad);
  needLoads = needLoads.map(fetchSome => fetchSome());

  routerConfig.some((route) => {
    // use `matchPath` here
    const match = matchPath(req.url, route);
    if (match) {
      needLoads.push(route.loadData(generateParams(match)));
      preLoadComponent = route.component;
    }
    return match;
  });

  return Promise.all(needLoads.map(load =>
    load(store.dispatch, store.getState))).then(() => preLoadComponent);
};

/**
 * generateCdnLibScriptTag:
 *  生成未打包进app.js，需要额外CDN加载的文件(主要是lib相关)
 */
const generateCdnLibScriptTag = () => {
  const cdnLibs = [
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/react/16.0.0/umd/react.production.min.js" crossorigin="anonymous"></script>',
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/16.0.0/umd/react-dom.production.min.js" crossorigin="anonymous"></script>'
  ];
  return cdnLibs.join('');
};

/**
 * generate ssr header and cache it
 * @param {*} store readux store
 * @param {*} serverRouteConf server router conf
 */
const generateHelmet = (store, serverRouteConf) => {
  const { url } = serverRouteConf;
  const curTime = new Date().getTime();
  if (!headInfoMCache.__cacheExpires__ || curTime < headInfoMCache.__cacheExpires__) {
    headInfoMCache.__cacheExpires__ = curTime + 86400000;
    headInfoMCache = {};
  }
  if (headInfoMCache[url]) {
    return headInfoMCache[url];
  }
  renderToStaticMarkup(<App store={store} serverRouteConf={serverRouteConf} />);
  const helmet = Helmet.renderStatic();
  const { title, link, meta } = helmet;
  headInfoMCache[url] = { title, link, meta };
  return helmet;
};

/**
 * Generate a async chunk script tag string
 * @param {*} content The async chunk file content
 * @param {*} filename The async chunk file name
 * @param {*} isProd Flag: is prod
 */
const generateChunkScript = (content, filename, isProd) => {
  if (isProd) {
    return `<script type="text/javascript" charset="utf-8">${content}</script></body>`;
  }
  // dev mode: single file script: for source map
  return `<script type="text/javascript" charset="utf-8" src="${devOutputPath}${filename}"></script></body>`;
};

/**
 * Generate ssr async chunk script tag string
 * @param {*} isProd Flag: is prod
 * @param {*} chunkObj file content map
 * @param {*} preLoadComponent need preload component from route conf
 */
const generateSsrPreloadChunk = (isProd, chunkObj, preLoadComponent) => {
  let chunkScripStr = '';
  for (const key in chunkObj) {
    const prefix = key.split('.')[0];
    if (prefix === preLoadComponent.chunkName
      || asyncCommonChunks.indexOf(prefix) >= 0) {
      chunkScripStr += generateChunkScript(chunkObj[key], key, isProd);
    }
  }
  return `${chunkScripStr}</body>`;
};

/**
 * Server entry middleware factory: config in, gegerate render middleware
 * @param {*} options config object
 */
const serverEntryMiddlewareCreator = ({
  html, log, isProd, chunkObj
}) => (req, res, next) => {
  const store = configureStore();
  createStoreAndLoadData(req, store).then((preLoadComponent) => {
    const serverRouteConf = {
      url: req.url
    };
    const helmet = generateHelmet(store, serverRouteConf);

    const renderStream =
      renderToNodeStream(<App store={store} serverRouteConf={serverRouteConf} />);

    // FB data Trigger
    renderStream.once('data', () => {
      const { title, link, meta } = helmet;
      const titleText = title.toString();
      const metaData = `${titleText}${meta.toString()}${link.toString()}`;
      // const matched = titleText.match(titleReg);

      const chunk = html.head.replace('<title></title>', metaData);
      res.write(chunk);
    });

    // stream data come
    renderStream.on('data', (chunk) => {
      res.write(chunk);
    });

    // stream end
    renderStream.on('end', () => {
      const state = store.getState();
      const cdnLibScript = isProd ? generateCdnLibScriptTag() : '';

      // externals出去的lib与state
      const libAndState = `</div>${cdnLibScript}<script>window.__INITIAL_STATE__=${
        JSON.stringify(state)
      }</script>`;
      let tail = html.tail;
      tail = tail.replace('</div>', libAndState);

      if (preLoadComponent) {
        const chunk = generateSsrPreloadChunk(isProd, chunkObj, preLoadComponent);
        tail = tail.replace('</body>', chunk);
      }
      res.end(tail);
    });

    renderStream.on('error', (err) => {
      res.end(html.origin);
      log.error(err);
    });
  }).catch((err) => {
    log.error(err);
    res.end(html.origin);
  });
};

export default serverEntryMiddlewareCreator;
