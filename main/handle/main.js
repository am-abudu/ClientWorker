import router_cgi from './cgi.js'
import CacheDB from '@chenyfan/cache-db'
import cons from './../utils/cons.js'
import FetchEngine from '../utils/engine.js'
import rebuild from '../utils/rebuild.js'
const clientworkerhandle = async (request) => {
    //当前域 new Request('').url
    const domain = new URL(new Request('').url).host
    const db = new CacheDB()

    let tReq = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        mode: request.mode === 'navigate' ? 'same-origin' : request.mode,
        credentials: request.credentials,
        redirect: request.redirect,
        cache: request.cache
    })
    const urlStr = tReq.url.toString()
    const urlObj = new URL(urlStr)
    const pathname = urlObj.pathname
    if (pathname.split('/')[1] === 'cw-cgi') {
        return router_cgi(request)
    }
    const config = await db.read('config', { type: "json" })
    if (!config) return fetch(request)

    let tFetched = false
    let EngineFetch = false
    let tRes = new Response()
    for (let catch_rule of config.catch_rules) {
        if (catch_rule.rule === '_') catch_rule.rule = domain
        if (!tReq.url.match(new RegExp(catch_rule.rule))) continue;
        let EngineFetchList = []
        for (let transform_rule of catch_rule.transform_rules) {
            let tSearched = false

            if (transform_rule.search === '_') transform_rule.search = catch_rule.rule
            switch (transform_rule.searchin || "url") {
                case 'url':
                    if (tReq.url.match(new RegExp(transform_rule.search, transform_rule.searchflags))) tSearched = true;
                    break
                case 'header':
                    cons.d(tReq.headers.get(transform_rule.searchkey))
                    if (tReq.headers.get(transform_rule.searchkey).match(new RegExp(transform_rule.search, transform_rule.searchflags))) tSearched = true;
                    break;
                case 'status':
                    if (!tFetched) { cons.w(`${tReq.url} is not fetched yet,the status rule are ignored`); break }
                    if (String(tRes.status).match(new RegExp(transform_rule.search, transform_rule.searchflags))) tSearched = true;
                    break
                case 'statusText':
                    if (!tFetched) { cons.w(`${tReq.url} is not fetched yet,the statusText rule are ignored`); break }
                    if (tRes.statusText.match(new RegExp(transform_rule.search, transform_rule.searchflags))) tSearched = true;
                    break
                case 'body':
                    if (!tFetched) { cons.w(`${tReq.url} is not fetched yet,the body rule are ignored`); break }
                    if ((await tRes.clone().text()).match(new RegExp(transform_rule.search, transform_rule.searchflags))) tSearched = true;
                    break;
                default:
                    cons.e(`${tReq.url} the ${transform_rule.searchin} search rule are not supported`);
                    break

            }

            switch (transform_rule.replacein || 'url') {
                case 'url':
                    if (tFetched && tSearched) { cons.w(`${tReq.url} is already fetched,the url transform rule:${transform_rule.search} are ignored`); break }
                    if (typeof transform_rule.replace !== 'undefined' && tSearched) {
                        if (typeof transform_rule.replace === 'string') {
                            if (EngineFetch) cons.w(`EngineFetch Disabled for ${tReq.url},the request will downgrade to normal fetch`)
                            tReq = rebuild.request(tReq, { url: tReq.url.replace(new RegExp(transform_rule.replacekey || transform_rule.search, transform_rule.replaceflags), transform_rule.replace) })
                            EngineFetch = false
                        } else {
                            if (EngineFetch) { cons.w(`Replacement cannot be used for ${tReq.url},the request is already powered by fetch-engine `); break }
                            transform_rule.replace.forEach(replacement => {
                                if (replacement === '_') {
                                    EngineFetchList.push(tReq)
                                    return;
                                }
                                EngineFetchList.push(
                                    rebuild.request(tReq, { url: tReq.url.replace(new RegExp(transform_rule.replacekey || transform_rule.search, transform_rule.replaceflags), replacement) })
                                )
                            });

                            EngineFetch = true
                        }
                    }
                    break
                case 'body':
                    if (tSearched) {
                        if (tFetched) {
                            tRes = rebuild.response(tRes, { body: (await tRes.clone().text()).replace(new RegExp(transform_rule.replacekey || transform_rule.search, transform_rule.replaceflags), transform_rule.replace) })

                        } else {
                            tReq = rebuild.request(tReq, { body: (await tReq.clone().text()).replace(new RegExp(transform_rule.replacekey || transform_rule.search, transform_rule.replaceflags), transform_rule.replace) })
                        }
                    }
                    break;

                case 'status':
                    if (typeof transform_rule.replace === 'string' && tSearched) tRes = rebuild.response(tRes, { status: tRes.status.replace(new RegExp(transform_rule.replacekey || transform_rule.search, transform_rule.replaceflags), transform_rule.replace) })
                    break;
                case 'statusText':
                    if (typeof transform_rule.replace === 'string' && tSearched) tRes = rebuild.response(tRes, { statusText: tRes.statusText.replace(new RegExp(transform_rule.replacekey || transform_rule.search, transform_rule.replaceflags), transform_rule.replace) })
                    break;
                default:
                    cons.e(`${tReq.url} the ${transform_rule.replacein} replace rule are not supported`);
            }
            if (!tSearched) continue
            if (typeof transform_rule.header === 'object') {
                for (var header in transform_rule.header) {
                    if (tFetched) {

                        tRes = rebuild.response(tRes, { headers: { [header]: transform_rule.header[header] } })
                    } else {
                        tReq = rebuild.request(tReq, { headers: { [header]: transform_rule.header[header] } })
                    }
                }
            }

            if (typeof transform_rule.action !== 'undefined') {
                switch (transform_rule.action) {
                    case 'fetch':
                        if (tFetched) { cons.w(`${tReq.url} is already fetched,the fetch action are ignored`); break }
                        if (typeof transform_rule.fetch === 'undefined') { cons.e(`Fetch Config is not defined for ${tReq.url}`); break }

                        let fetchConfig = {
                            status: transform_rule.fetch.status,
                            mode: transform_rule.fetch.mode,
                            credentials: transform_rule.fetch.credentials,
                            redirect: transform_rule.fetch.redirect,
                            timeout: transform_rule.fetch.timeout
                        }
                        if (!transform_rule.fetch.preflight) {
                            tReq = new Request(tReq.url, {
                                method: ((method) => {
                                    if (method === "GET" || method === "HEAD" || method === "POST") return method;
                                    return "GET"
                                })(tReq.method),
                                body: ((body) => {
                                    if (tReq.method === "POST") return body;
                                    return null
                                })(tReq.body)
                            }) //https://segmentfault.com/a/1190000006095018
                            delete fetchConfig.credentials
                            fetchConfig.mode = "cors"
                            for (var eReq in EngineFetchList) {
                                EngineFetchList[eReq] = new Request(EngineFetchList[eReq].url, tReq)
                            }
                        }
                        tRes = await Promise.any([
                            new Promise(async (resolve, reject) => {
                                let cRes
                                if (!EngineFetch) {
                                    cRes = await FetchEngine.fetch(tReq, fetchConfig)
                                } else {
                                    switch (transform_rule.fetch.engine) {
                                        case 'classic':
                                            cRes = await FetchEngine.classic(EngineFetchList, fetchConfig)
                                            break;
                                        case 'parallel':
                                            cRes = await FetchEngine.parallel(EngineFetchList, fetchConfig)
                                            cRes = rebuild.response(cRes, { url: '' })
                                            break;
                                        default:
                                            cons.e(`Fetch Engine ${transform_rule.fetch.engine} is not supported`)
                                            break;
                                    }

                                }
                                if (typeof transform_rule.fetch.cache === "object" && cRes.status === (transform_rule.fetch.status || 200)) {
                                    cRes = rebuild.response(cRes, { headers: { "ClientWorker_CacheTime": new Date().getTime() } })
                                    caches.open("ClientWorker_ResponseCache").then(cache => {
                                        cache.put(tReq, cRes.clone())
                                            .then(() => { resolve(cRes) })
                                    })
                                }
                                else { resolve(cRes) }
                            })
                        ],
                            new Promise(async (resolve, reject) => {
                                if (typeof transform_rule.fetch.cache === "object") {
                                    setTimeout(() => {

                                        caches.open("ClientWorker_ResponseCache").then(cache => {
                                            cache.match(tReq).then(cRes => {
                                                if (!!cRes) {
                                                    if (Number(cRes.headers.get('ClientWorker_CacheTime')) + eval(transform_rule.fetch.cache.expire || '0') > new Date().getTime()) {
                                                        cons.s(`${tReq.url} is timeout for delay ${transform_rule.fetch.cache.delay},so return by cache`)
                                                        resolve(cRes)
                                                    } else {
                                                        setTimeout(() => {
                                                            cons.e(`${tReq.url} is too late to fetch,even though the cache has expired,so return by cache`)
                                                        }, transform_rule.fetch.cache.expired_delay || 2800);
                                                    }
                                                } else {
                                                    cons.w(`${tReq.url} is not cached!And it is too late to fetch!`)
                                                }
                                            })
                                        })

                                    }, transform_rule.fetch.cache.delay || 200);
                                }
                            })

                        )
                        tFetched = true
                        break
                    case 'redirect':
                        if (typeof transform_rule.redirect === 'undefined') continue
                        if (typeof transform_rule.redirect.url === 'string') return Response.redirect(transform_rule.redirect.url, transform_rule.redirect.status || 301)
                        return Response.redirect(
                            tReq.url.replace(new RegExp(transform_rule.search), transform_rule.redirect.to),
                            transform_rule.redirect.status || 301
                        )
                    case 'return':
                        if (typeof transform_rule.return === 'undefined') transform_rule.return = {}
                        return new Response(transform_rule.return.body || "Error!", {
                            status: transform_rule.return.status || 503,
                            headers: transform_rule.return.headers || {}
                        })
                    default:
                        cons.w(`This Action:${transform_rule.action} is not supported yet`)
                        break
                }
            }
        }


    }
    if (!tFetched) {
        if (EngineFetch) {
            tRes = await FetchEngine.classic(EngineFetchList, fetchConfig || { status: 200 })
        } else {
            tRes = await fetch(tReq)
        }
    }
    return tRes
}

export default clientworkerhandle