import http from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { createModelGateway } from '../deploy/production/model-gateway/gateway.mjs'
it('hides reusable keys, restricts endpoints/hosted tools, and bounds requests and output tokens', async () => {
  let captured
  const upstream = http.createServer(async (req, res) => {
    const parts=[];for await(const chunk of req)parts.push(chunk)
    captured={headers:req.headers,body:JSON.parse(Buffer.concat(parts).toString())}
    res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'fixture'}))
  })
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening')
  const gateway=createModelGateway({provider:'codex',secret:'reusable-key-must-stay-in-gateway',maxRequests:1,maxTokens:64,request:(options,callback)=>http.request({...options,hostname:'127.0.0.1',port:upstream.address().port},callback)})
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening')
  const url=`http://127.0.0.1:${gateway.address().port}`
  try {
    expect((await fetch(url+'/v1/models')).status).toBe(404)
    const result=await fetch(url+'/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer placeholder'},body:JSON.stringify({model:'gpt-test',max_output_tokens:999999,store:true,tools:[{type:'web_search'},{type:'function',name:'local'}],mcp_servers:[{url:'https://bad.test'}]})})
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({id:'fixture'})
    expect(captured.headers.authorization).toBe('Bearer reusable-key-must-stay-in-gateway')
    expect(captured.body).toMatchObject({max_output_tokens:64,store:false,tools:[{type:'function',name:'local'}]})
    expect(captured.body.mcp_servers).toBeUndefined()
    expect((await fetch(url+'/v1/responses',{method:'POST',body:'{}'})).status).toBe(429)
  } finally {gateway.closeAllConnections();gateway.close();upstream.closeAllConnections();upstream.close()}
})
