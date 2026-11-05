/** 验证局域网和反向代理入口的部署地址。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { webConfiguration } from '../run.mjs'

const interfaces = { eth0: [{ family: 'IPv4', internal: false, address: '172.18.0.2' }] }

test('同时接受局域网和 Lucky 地址，不依赖转发头建立信任', () => {
  assert.deepEqual(webConfiguration({
    DSH_PUBLIC_URL: 'https://dsh.example.com',
    DSH_TRUSTED_HOSTS: '192.168.1.50:3080, dsh.example.com',
  }, interfaces), {
    host: '172.18.0.2', publicUrl: 'https://dsh.example.com/',
    trustedHosts: ['dsh.example.com', '192.168.1.50:3080'],
  })
})

test('支持明确的具体监听 IP 和局域网 HTTP 公告地址', () => {
  assert.equal(webConfiguration({
    DSH_PUBLIC_URL: 'http://192.168.1.50:3080', DSH_BIND_HOST: '127.0.0.1',
  }, {}).host, '127.0.0.1')
})

test('拒绝通配或缺失的监听 IP 及格式不合法的公告 URL', () => {
  for (const host of ['0.0.0.0', '::', 'not-an-ip']) {
    assert.throws(() => webConfiguration({ DSH_PUBLIC_URL: 'https://dsh.example.com', DSH_BIND_HOST: host }, interfaces))
  }
  assert.throws(() => webConfiguration({ DSH_PUBLIC_URL: 'https://dsh.example.com' }, {}))
  for (const url of ['', 'file:///tmp/app', 'https://user:pass@dsh.example.com', 'https://dsh.example.com/ui/', 'https://dsh.example.com/?token=x']) {
    assert.throws(() => webConfiguration({ DSH_PUBLIC_URL: url }, interfaces))
  }
  assert.throws(() => webConfiguration({ DSH_PUBLIC_URL: 'not-a-url' }, interfaces), /DSH_PUBLIC_URL 不是有效的 HTTP\(S\) URL/)
})
