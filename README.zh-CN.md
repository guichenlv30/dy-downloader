# 鎶栭煶涓嬭浇鍣?V2.0锛圖ouyin Downloader锛?

<p align="center">
  <strong>dy-downloader</strong>
</p>

涓€涓潰鍚戝疄鐢ㄥ満鏅殑鎶栭煶涓嬭浇宸ュ叿锛屾敮鎸佽棰戙€佸浘鏂囥€佸悎闆嗐€侀煶涔愩€佹敹钘忓す绛夊绉嶇被鍨嬩笅杞斤紝浠ュ強浣滆€呬富椤垫壒閲忎笅杞斤紝榛樿甯﹁繘搴﹀睍绀恒€侀噸璇曘€佹暟鎹簱鍘婚噸銆佷笅杞藉畬鏁存€ф牎楠屽拰娴忚鍣ㄥ厹搴曡兘鍔涖€?

## 妗岄潰鐗堬紙Douzy锛?

鍩轰簬鍚屼竴濂楀悗绔墦閫犵殑妗岄潰瀹㈡埛绔€斺€旂矘璐撮摼鎺ュ嵆鍒诲紑濮嬶紝鍚屾鍏虫敞鍒楄〃锛屽彲瑙嗗寲璺熻釜涓嬭浇杩涘害銆?

<table>
  <tr>
    <td width="33%"><img src="./img/desktop/001.png" alt="涓嬭浇 鈥?绮樿创閾炬帴鍗冲埢寮€濮? width="100%" /><br/><sub>涓嬭浇 路 绮樿创閾炬帴鍗冲埢寮€濮?/sub></td>
    <td width="33%"><img src="./img/desktop/002.png" alt="鍏虫敞鍚屾" width="100%" /><br/><sub>鍏虫敞 路 鍚屾鍗氫富鍒楄〃</sub></td>
    <td width="33%"><img src="./img/desktop/003.png" alt="浠诲姟涓績" width="100%" /><br/><sub>浠诲姟涓績 路 閫愪换鍔＄姸鎬?/sub></td>
  </tr>
  <tr>
    <td width="33%"><img src="./img/desktop/004.png" alt="浣滃搧妗ｆ涓庣瓫閫? width="100%" /><br/><sub>浣滃搧妗ｆ 路 SQLite 鍘嗗彶涓庣瓫閫?/sub></td>
    <td width="33%"><img src="./img/desktop/005.png" alt="璁剧疆涓庡懡鍚嶆ā鏉? width="100%" /><br/><sub>璁剧疆 路 鏂囦欢鍛藉悕妯℃澘</sub></td>
    <td width="33%"><img src="./img/desktop/006.png" alt="瀹炴椂涓嬭浇杩涘害" width="100%" /><br/><sub>瀹炴椂杩涘害 路 閫愪换鍔′簨浠舵棩蹇?/sub></td>
  </tr>
</table>

## 鍔熻兘姒傝

### 宸叉敮鎸?

| 鍔熻兘 | 璇存槑 |
|------|------|
| 鍗曚釜瑙嗛涓嬭浇 | `/video/{aweme_id}` |
| 鍗曚釜鍥炬枃涓嬭浇 | `/note/{note_id}`銆乣/gallery/{note_id}` |
| 鍗曚釜鍚堥泦涓嬭浇 | `/collection/{mix_id}`銆乣/mix/{mix_id}` |
| 鍗曚釜闊充箰涓嬭浇 | `/music/{music_id}`锛堜紭鍏堝師澹版枃浠讹紝缂哄け鏃跺洖閫€鍒拌闊充箰涓嬮鏉′綔鍝侊級 |
| 鐭摼鑷姩瑙ｆ瀽 | `https://v.douyin.com/...`銆乣v.iesdouyin.com`锛屽惈瑁?host |
| 鐢ㄦ埛涓婚〉鎵归噺涓嬭浇 | `/user/{sec_uid}` + `mode: [post, like, mix, music]` |
| 褰撳墠鐧诲綍璐﹀彿鏀惰棌澶逛笅杞?| `/user/self?showTab=favorite_collection` + `mode: [collect, collectmix]` |
| 鏃犳按鍗颁紭鍏?| 鑷姩閫夋嫨鏃犳按鍗拌棰戞簮 |
| 鏈€楂樻竻鑷姩鎸戦€?| 鍩轰簬 `video.bit_rate` 鏁扮粍鑷姩閫夋渶楂樼爜鐜囷紙瑙嗛 + 瀹炲喌鍥剧敓鏁堬級 |
| **鐩存挱褰曞埗** | `live.douyin.com/{room_id}` 鈫?FLV/HLS锛屼富鎾笅鎾椂淇濈暀宸插綍鏁版嵁 |
| **璇勮閲囬泦** | 鎸変綔鍝佹姄璇勮锛堝彲鍚簩绾у洖澶嶏級锛岃緭鍑?`*_comments.json` |
| **鐑悳姒?+ 鍏抽敭璇嶆悳绱?* | `--hot-board [N]` / `--search "鍏抽敭璇?`锛岀粨鏋滆惤 JSONL |
| **REST API 鏈嶅姟妯″紡** | `--serve --serve-port 8000`锛堝彲閫?`fastapi + uvicorn`锛?|
| **瀹屾垚閫氱煡鎺ㄩ€?* | 涓嬭浇瀹屾垚鍚庢帹 Bark / Telegram / Webhook |
| 闄勫姞璧勬簮涓嬭浇 | 灏侀潰銆侀煶涔愩€佸ご鍍忋€丣SON 鍏冩暟鎹?|
| 瑙嗛杞啓 | 鍙€夊姛鑳斤紝璋冪敤 OpenAI Transcriptions API |
| 骞跺彂涓嬭浇 | 鍙厤缃苟鍙戞暟锛岄粯璁?5 |
| 澶辫触閲嶈瘯 | 鎸囨暟閫€閬块噸璇曪紙1s, 2s, 5s锛?|
| 閫熺巼闄愬埗 | 榛樿 2 璇锋眰/绉?|
| SQLite 鍘婚噸 | 鏁版嵁搴?+ 鏈湴鏂囦欢鍙岄噸鍘婚噸 |
| 澧為噺涓嬭浇 | `increase.post/like/mix/music` |
| 鏃堕棿杩囨护 | `start_time` / `end_time` |
| 娴忚鍣ㄥ厹搴?| 缈婚〉鍙楅檺鏃跺惎鍔ㄦ祻瑙堝櫒锛屾敮鎸佷汉宸ヨ繃楠岃瘉鐮?|
| 涓嬭浇瀹屾暣鎬ф牎楠?| Content-Length 姣斿锛屼笉瀹屾暣鏂囦欢鑷姩娓呯悊骞堕噸璇?|
| 杩涘害鏉″睍绀?| Rich 杩涘害鏉★紝鏀寔 `progress.quiet_logs` 闈欓粯妯″紡 |
| Docker 閮ㄧ讲 | 鎻愪緵 Dockerfile |
| CI/CD | GitHub Actions 鑷姩娴嬭瘯鍜?lint |

### 闄愬埗璇存槑

- 娴忚鍣ㄥ厹搴曞綋鍓嶄粎閽堝 `post` 瀹屾暣楠岃瘉锛宍like/mix/music` 涓昏渚濊禆 API 姝ｅ父鍒嗛〉
- `number.allmix` / `increase.allmix` 浣滀负鍏煎鍒悕淇濈暀锛岃繍琛屾椂浼氬綊涓€鍖栧埌 `mix`
- `collect` / `collectmix` 褰撳墠浠呮敮鎸佸綋鍓嶅凡鐧诲綍 Cookie 瀵瑰簲璐﹀彿
- `collect` / `collectmix` 蹇呴』鍗曠嫭浣跨敤锛屼笉鑳藉拰 `post` / `like` / `mix` / `music` 娣风敤
- `increase` 褰撳墠浠呮敮鎸?`post` / `like` / `mix` / `music`锛涙敹钘忓す妯″紡涓嶆敮鎸佸閲忔埅鏂?
- 鐩存挱褰曞埗 FLV 鍙洿鎺ユ挱鏀撅紱HLS 婧愬彧淇濆瓨 playlist 鏂囦欢锛堥渶瑕佺敤 ffmpeg 鍚庡鐞嗭級
- webcast 鐩存挱鎺ュ彛鏈鐩栨墍鏈夊満鏅紝瑙嗕负 experimental

## 蹇€熷紑濮?

### 1) 鐜鍑嗗

- Python 3.8+
- macOS / Linux / Windows

### 2) 瀹夎渚濊禆

```bash
pip install -r requirements.txt
```

濡傞渶娴忚鍣ㄥ厹搴曟垨鑷姩鑾峰彇 Cookie锛?

```bash
pip install playwright
python -m playwright install chromium
```

### 3) 澶嶅埗閰嶇疆

```bash
python run.py --serve --serve-host 127.0.0.1 --serve-port 8000
```

### 4) 鑾峰彇 Cookie锛堟帹鑽愯嚜鍔ㄦ柟寮忥級

```bash
http://127.0.0.1:8000
```

鐧诲綍鎶栭煶鍚庡洖鍒扮粓绔寜 Enter锛岀▼搴忎細鑷姩鍐欏叆閰嶇疆銆?

### 5) Docker 閮ㄧ讲锛堝彲閫夛級

```bash
docker build -t dy-downloader .
docker run -v $(pwd)/data:/app/data dy-downloader
```

## 鏈€灏忓彲鐢ㄩ厤缃?

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx

path: ./Downloaded/
mode:
  - post

number:
  post: 0
  collect: 0
  collectmix: 0

thread: 5
retry_times: 3
proxy: ""
database: true
database_path: ./data/dy_downloader.db

progress:
  quiet_logs: true

browser_fallback:
  enabled: true
  headless: false
  max_scrolls: 240
  idle_rounds: 8
  wait_timeout_seconds: 600

transcript:
  enabled: false
  model: gpt-4o-mini-transcribe
  output_dir: ""
  response_formats: ["txt", "json"]
  api_url: https://api.openai.com/v1/audio/transcriptions
  api_key_env: OPENAI_API_KEY
  api_key: ""
```

## 浣跨敤鏂瑰紡

### 浣跨敤閰嶇疆鏂囦欢杩愯

```bash
python run.py -c config.yml
```

### 鍛戒护琛岃拷鍔犲弬鏁?

```bash
python run.py -c config.yml \
  -u "https://www.douyin.com/video/7604129988555574538" \
  -t 8 \
  -p ./Downloaded
```

### 鍙傛暟璇存槑

| 鍙傛暟 | 璇存槑 |
|------|------|
| `-u, --url` | 杩藉姞涓嬭浇閾炬帴锛堝彲閲嶅浼犲叆锛?|
| `-c, --config` | 鎸囧畾閰嶇疆鏂囦欢锛堥粯璁?`config.yml`锛?|
| `-p, --path` | 鎸囧畾涓嬭浇鐩綍 |
| `-t, --thread` | 鎸囧畾骞跺彂鏁?|
| `--show-warnings` | 鏄剧ず warning/error 鏃ュ織 |
| `-v, --verbose` | 鏄剧ず info/warning/error 鏃ュ織 |
| `--hot-board [N]` | 鎷夊彇鎶栭煶鐑悳姒滃苟瀵煎嚭 JSONL锛屽彲閫変笂闄?N |
| `--search KEYWORD` | 鎸夊叧閿瘝鎼滅储浣滃搧骞跺鍑?JSONL |
| `--search-max N` | `--search` 鍦烘櫙涓嬫渶澶氭媺鍙栨潯鏁帮紙榛樿 50锛?|
| `--serve` | 浠?REST API 鏈嶅姟妯″紡杩愯锛堥渶瑕?`pip install fastapi uvicorn`锛?|
| `--serve-host HOST` | REST 鏈嶅姟鐩戝惉鍦板潃锛堥粯璁?127.0.0.1锛?|
| `--serve-port PORT` | REST 鏈嶅姟鐩戝惉绔彛锛堥粯璁?8000锛?|
| `--version` | 鏄剧ず鐗堟湰鍙?|

## 鍏稿瀷鍦烘櫙

### 涓嬭浇鍗曚釜瑙嗛

```yaml
link:
  - https://www.douyin.com/video/7604129988555574538
```

### 涓嬭浇鍗曚釜鍥炬枃

```yaml
link:
  - https://www.douyin.com/note/7341234567890123456
```

### 涓嬭浇鍗曚釜鍚堥泦

```yaml
link:
  - https://www.douyin.com/collection/7341234567890123456
```

### 涓嬭浇鍗曚釜闊充箰

```yaml
link:
  - https://www.douyin.com/music/7341234567890123456
```

### 鎵归噺涓嬭浇浣滆€呬富椤典綔鍝?

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx
mode:
  - post
number:
  post: 50
```

### 鎵归噺涓嬭浇浣滆€呯偣璧炰綔鍝?

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx
mode:
  - like
number:
  like: 0    # 0 琛ㄧず鍏ㄩ噺涓嬭浇
```

### 鍚屾椂涓嬭浇澶氱妯″紡

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx
mode:
  - post
  - like
  - mix
  - music
```

璺ㄦā寮忚嚜鍔ㄥ幓閲嶏細鍚屼竴涓?aweme_id 鍦ㄤ笉鍚屾ā寮忎笅涓嶄細閲嶅涓嬭浇銆?

### 鎵归噺涓嬭浇褰撳墠鐧诲綍璐﹀彿鏀惰棌澶逛綔鍝?

```yaml
link:
  - https://www.douyin.com/user/self?showTab=favorite_collection
mode:
  - collect
number:
  collect: 0
```

### 鎵归噺涓嬭浇褰撳墠鐧诲綍璐﹀彿鏀惰棌鍚堥泦

```yaml
link:
  - https://www.douyin.com/user/self?showTab=favorite_collection
mode:
  - collectmix
number:
  collectmix: 0
```

### 褰曞埗鐩存挱锛堝疄楠屾€э級

```yaml
link:
  - https://live.douyin.com/123456789   # 涔熸敮鎸?/follow/live/{room_id}
live:
  max_duration_seconds: 3600   # 0 = 褰曞埌涓绘挱涓嬫挱
  chunk_size: 65536
  idle_timeout_seconds: 30
```

褰曞埗鐨?FLV 浼氫繚瀛樺湪 `Downloaded/{浣滆€厎/live/` 涓嬶紝骞堕檮甯?`*_room.json` 鐩存挱闂村厓鏁版嵁蹇収銆?
涓绘挱涓嬫挱銆佺綉缁滅┖闂叉垨 Ctrl+C 涓柇鏃讹紝**宸插綍鍒剁殑瀛楄妭浼氳淇濈暀**锛?tmp 鏂囦欢鑷姩鎻愬崌涓烘寮忔枃浠讹級銆?

### 閲囬泦浣滃搧璇勮

```yaml
comments:
  enabled: true
  include_replies: false   # 璁句负 true 浼氬鎷夋瘡鏉¤瘎璁虹殑浜岀骇鍥炲锛堥澶栬姹傞噺锛?
  max_comments: 500        # 0 = 涓嶉檺
  page_size: 20
```

浼氬湪濯掍綋鏂囦欢鏃佺敓鎴?`{date}_{title}_{aweme_id}_comments.json`銆?

### 瀵煎嚭鐑悳姒滃揩鐓?

```bash
python run.py --hot-board 30 -p ./Downloaded
# 杈撳嚭锛?/Downloaded/hot_board/20260424_221530.jsonl
```

### 鍏抽敭璇嶆悳绱?

```bash
python run.py --search "鐚挭" --search-max 100 -p ./Downloaded
# 杈撳嚭锛?/Downloaded/search/鐚挭_20260424_221530.jsonl
```

### 浠?REST API 鏈嶅姟妯″紡杩愯

```bash
pip install fastapi uvicorn       # 涓€娆℃€у彲閫変緷璧?
python run.py --serve --serve-port 8000
```

鎺ュ彛锛?

| Method | Path | 璇存槑 |
|--------|------|------|
| POST | `/api/v1/download` | 鎻愪氦 `{"url": "..."}`锛岃繑鍥?`{job_id, status}` |
| GET | `/api/v1/jobs/{job_id}` | 鏌ヨ鎸囧畾 job 鐨勭姸鎬?璁℃暟 |
| GET | `/api/v1/jobs` | 鍒楀嚭鏈€杩戠殑 job锛堟寜 TTL + 瀹归噺鍓锛?|
| GET | `/api/v1/health` | 鍋ュ悍鎺㈤拡 |

瀹屾垚鎬佺殑 job 浼氭寜 TTL锛堥粯璁?24 灏忔椂锛? 鏈€澶ф暟閲忥紙榛樿 500锛夎嚜鍔ㄥ壀瑁侊紱in-flight 鐨?job 姘镐笉琚鎺夈€?
鍙€氳繃 `server.max_jobs` / `server.job_ttl_seconds` 璋冩暣銆?

### 瀹屾垚鍚庡彂閫侀€氱煡

```yaml
notifications:
  enabled: true
  on_success: true
  on_failure: true
  providers:
    - type: bark
      url: https://api.day.app/YOUR_DEVICE_KEY
      sound: bell
    - type: telegram
      bot_token: "123456:ABC..."
      chat_id: "987654321"
    - type: webhook                 # 浼佷笟寰俊/椋炰功/閽夐拤 bot URL 鍚屾牱鍙敤
      url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
      extra_body:
        msgtype: text
```

鎵€鏈夊惎鐢ㄧ殑 provider 浼氬苟鍙戞帹閫侊紱鍗曚釜 provider 澶辫触涓嶄細闃诲涓讳笅杞芥祦绋嬨€?

### 澧為噺涓嬭浇锛堝彧涓嬭浇鏂颁綔鍝侊級

```yaml
increase:
  post: true
database: true    # 澧為噺妯″紡渚濊禆鏁版嵁搴撹褰?
```

### 鍏ㄩ噺鎶撳彇锛堜笉闄愬埗鏁伴噺锛?

```yaml
number:
  post: 0
```

## 鍙€夊姛鑳斤細瑙嗛杞啓锛坱ranscript锛?

褰撳墠瀹炵幇浠呭**瑙嗛浣滃搧**鐢熸晥锛堝浘鏂囦笉浼氱敓鎴愯浆鍐欙級銆?

### 1) 寮€鍚柟寮?

```yaml
transcript:
  enabled: true
  model: gpt-4o-mini-transcribe
  output_dir: ""        # 鐣欑┖: 涓庤棰戝悓鐩綍锛涢潪绌? 闀滃儚鍒版寚瀹氱洰褰?
  response_formats:
    - txt
    - json
  api_key_env: OPENAI_API_KEY
  api_key: ""           # 鍙洿鎺ュ～锛屾垨浣跨敤鐜鍙橀噺
```

鎺ㄨ崘閫氳繃鐜鍙橀噺鎻愪緵瀵嗛挜锛?

```bash
export OPENAI_API_KEY="sk-xxxx"
```

### 2) 杈撳嚭鏂囦欢

鍚敤鍚庝細鐢熸垚锛?

- `xxx.transcript.txt`
- `xxx.transcript.json`

鑻?`database: true`锛屼細鍦ㄦ暟鎹簱 `transcript_job` 琛ㄨ褰曠姸鎬侊紙`success/failed/skipped`锛夈€?

## 娴嬭瘯

鎺ㄨ崘浣跨敤锛?

```bash
python3 -m pytest -q
```

褰撳墠涔熸敮鎸佺洿鎺ヨ繍琛岋細

```bash
pytest -q
```

## 鍏抽敭閰嶇疆椤?

| 閰嶇疆椤?| 璇存槑 |
|--------|------|
| `mode` | 鏀寔 `post`/`like`/`mix`/`music`锛涘綋鍓嶇櫥褰曟敹钘忓す妯″紡棰濆鏀寔鍗曠嫭浣跨敤鐨?`collect`/`collectmix` |
| `number.post/like/mix/music/collect/collectmix` | 鍚勬ā寮忎笅杞芥暟閲忛檺鍒讹紝0 涓轰笉闄?|
| `increase.post/like/mix/music` | 鍚勬ā寮忓閲忓紑鍏?|
| `start_time` / `end_time` | 鏃堕棿杩囨护锛堟牸寮?`YYYY-MM-DD`锛?|
| `folderstyle` | 鎸変綔鍝佺淮搴﹀垱寤哄瓙鐩綍 |
| `browser_fallback.*` | `post` 缈婚〉鍙楅檺鏃跺惎鐢ㄦ祻瑙堝櫒鍏滃簳 |
| `progress.quiet_logs` | 杩涘害闃舵闈欓粯鏃ュ織锛屽噺灏戝埛灞?|
| `transcript.*` | 瑙嗛涓嬭浇鍚庣殑鍙€夎浆鍐?|
| `proxy` | 涓?API 璇锋眰鍜屽獟浣撲笅杞借缃?HTTP/HTTPS 浠ｇ悊锛屼緥濡?`http://127.0.0.1:7890` |
| `comments.*` | 鎸変綔鍝侀噰闆嗚瘎璁猴紙榛樿鍏抽棴锛?|
| `live.*` | 鐩存挱褰曞埗鍙傛暟锛坢ax_duration_seconds / chunk_size / idle_timeout_seconds锛?|
| `notifications.*` | 涓嬭浇瀹屾垚鍚?Bark/Telegram/Webhook 鎺ㄩ€?|
| `server.*` | REST API 鏈嶅姟璋冧紭锛坢ax_jobs銆乯ob_ttl_seconds锛?|
| `database` | 鍚敤 SQLite 鍘婚噸鍜屽巻鍙茶褰?|
| `database_path` | SQLite 鏂囦欢璺緞锛岄粯璁ゅ湪褰撳墠宸ヤ綔鐩綍鐢熸垚 `dy_downloader.db` |
| `thread` | 骞跺彂涓嬭浇鏁?|
| `retry_times` | 澶辫触閲嶈瘯娆℃暟 |

## 杈撳嚭鐩綍

榛樿 `folderstyle: true` 涓?`database_path: dy_downloader.db` 鏃讹細

```text
宸ヤ綔鐩綍/
鈹溾攢鈹€ config.yml
鈹溾攢鈹€ dy_downloader.db          # database: true 鏃堕粯璁ょ敓鎴愬湪杩欓噷
鈹斺攢鈹€ Downloaded/
    鈹溾攢鈹€ download_manifest.jsonl
    鈹斺攢鈹€ 浣滆€呭悕/
        鈹溾攢鈹€ post/
        鈹?  鈹斺攢鈹€ 2024-02-07_浣滃搧鏍囬_aweme_id/
        鈹?      鈹溾攢鈹€ ...mp4
        鈹?      鈹溾攢鈹€ ..._cover.jpg
        鈹?      鈹溾攢鈹€ ..._music.mp3
        鈹?      鈹溾攢鈹€ ..._data.json
        鈹?      鈹溾攢鈹€ ..._avatar.jpg
        鈹?      鈹溾攢鈹€ ...transcript.txt
        鈹?      鈹斺攢鈹€ ...transcript.json
        鈹溾攢鈹€ like/
        鈹?  鈹斺攢鈹€ ...
        鈹溾攢鈹€ mix/
        鈹?  鈹斺攢鈹€ ...
        鈹溾攢鈹€ music/
        鈹?  鈹斺攢鈹€ ...
        鈹溾攢鈹€ collect/
        鈹?  鈹斺攢鈹€ ...
        鈹斺攢鈹€ collectmix/
            鈹斺攢鈹€ ...
Downloaded/
鈹溾攢鈹€ download_manifest.jsonl
鈹溾攢鈹€ dy_downloader.db          # database: true 鏃剁敓鎴?
鈹溾攢鈹€ hot_board/                # 浣跨敤 --hot-board 鏃剁敓鎴?
鈹?  鈹斺攢鈹€ 20260424_221530.jsonl
鈹溾攢鈹€ search/                   # 浣跨敤 --search 鏃剁敓鎴?
鈹?  鈹斺攢鈹€ 鐚挭_20260424_221530.jsonl
鈹斺攢鈹€ 浣滆€呭悕/
    鈹溾攢鈹€ post/
    鈹?  鈹斺攢鈹€ 2024-02-07_浣滃搧鏍囬_aweme_id/
    鈹?      鈹溾攢鈹€ ...mp4
    鈹?      鈹溾攢鈹€ ..._cover.jpg
    鈹?      鈹溾攢鈹€ ..._music.mp3
    鈹?      鈹溾攢鈹€ ..._data.json
    鈹?      鈹溾攢鈹€ ..._avatar.jpg
    鈹?      鈹溾攢鈹€ ..._comments.json    # comments.enabled 鏃剁敓鎴?
    鈹?      鈹溾攢鈹€ ...transcript.txt
    鈹?      鈹斺攢鈹€ ...transcript.json
    鈹溾攢鈹€ like/
    鈹?  鈹斺攢鈹€ ...
    鈹溾攢鈹€ mix/
    鈹?  鈹斺攢鈹€ ...
    鈹溾攢鈹€ music/
    鈹?  鈹斺攢鈹€ ...
    鈹斺攢鈹€ live/                 # 褰曞埗鐩存挱鏃剁敓鎴?
        鈹斺攢鈹€ 2026-04-24_2215_鐩存挱鏍囬_鎴块棿鍙?
            鈹溾攢鈹€ ...flv
            鈹斺攢鈹€ ..._room.json
```

## 閲嶆柊涓嬭浇

绋嬪簭閫氳繃**鏁版嵁搴撹褰?+ 鏈湴鏂囦欢**鍙岄噸妫€鏌ュ垽鏂槸鍚﹁烦杩囧凡涓嬭浇鍐呭銆傝閲嶆柊涓嬭浇锛岄渶瑕佹寜浠ヤ笅鏂瑰紡娓呯悊鏁版嵁锛?

### 閲嶆柊涓嬭浇鐗瑰畾浣滃搧

```bash
# 鍒犻櫎鏈湴鏂囦欢锛堟枃浠跺悕涓寘鍚?aweme_id锛?
rm -rf Downloaded/浣滆€呭悕/post/*_<aweme_id>/

# 鍒犻櫎鏁版嵁搴撹褰?
sqlite3 data/dy_downloader.db "DELETE FROM aweme WHERE aweme_id = '<aweme_id>';"
```

### 閲嶆柊涓嬭浇鏌愪釜浣滆€呯殑鍏ㄩ儴浣滃搧

```bash
rm -rf Downloaded/浣滆€呭悕/
sqlite3 data/dy_downloader.db "DELETE FROM aweme WHERE author_name = '浣滆€呭悕';"
```

### 鍏ㄩ儴浠庨浂閲嶆柊涓嬭浇

```bash
rm -rf Downloaded/
rm dy_downloader.db
```

> **娉ㄦ剰锛?* 鍙垹鏁版嵁搴撲笉鍒犳枃浠朵笉浼氳Е鍙戦噸鏂颁笅杞解€斺€旂▼搴忎細鎵弿鏈湴鏂囦欢鍚嶄腑鐨?aweme_id 杩涜鍘婚噸銆傚彧鍒犳枃浠朵笉鍒犳暟鎹簱浼氳Е鍙戦噸鏂颁笅杞斤紙鏁版嵁搴撲腑鏈夎褰曚絾鏂囦欢涓嶅瓨鍦ㄦ椂瑙嗕负闇€瑕侀噸鏂颁笅杞斤級銆?

## 甯歌闂

### 1) 鍙兘鎶撳埌 20 鏉′綔鍝佹€庝箞鍔烇紵

杩欐槸缈婚〉椋庢帶鐨勫父瑙佺幇璞°€傜‘淇濓細

- `browser_fallback.enabled: true`
- `browser_fallback.headless: false`
- 娴忚鍣ㄥ脊绐楀嚭鐜板悗鎵嬪姩瀹屾垚楠岃瘉锛屼笉瑕佺珛鍗冲叧闂獥鍙?

### 2) 杩涘害鏉″嚭鐜伴噸澶嶅埛灞忔€庝箞鍔烇紵

榛樿 `progress.quiet_logs: true` 浼氬湪杩涘害闃舵闈欓粯鏃ュ織銆?
璋冭瘯鏃跺啀涓存椂鍔?`--show-warnings` 鎴?`-v`銆?

### 3) Cookie 澶辨晥鎬庝箞鍔烇紵

閲嶆柊鎵ц锛?

```bash
python run.py --serve --serve-host 127.0.0.1 --serve-port 8000
```

### 4) 涓轰粈涔堟病鏈夌敓鎴?transcript 鏂囦欢锛?

璇蜂緷娆℃鏌ワ細

- `transcript.enabled` 鏄惁涓?`true`
- 鏄惁涓嬭浇鐨勬槸瑙嗛锛堝浘鏂囦笉杞啓锛?
- `OPENAI_API_KEY`锛堟垨 `transcript.api_key`锛夋槸鍚︽湁鏁?
- `response_formats` 鏄惁鍖呭惈 `txt` 鎴?`json`

### 5) 濡備綍鏌ョ湅涓嬭浇鍘嗗彶锛?

```bash
sqlite3 data/dy_downloader.db "SELECT aweme_id, title, author_name, datetime(download_time, 'unixepoch', 'localtime') FROM aweme ORDER BY download_time DESC LIMIT 20;"
```

## 鍏嶈矗澹版槑

鏈」鐩粎鐢ㄤ簬鎶€鏈爺绌躲€佸涔犱氦娴佷笌涓汉鏁版嵁绠＄悊銆傝鍦ㄥ悎娉曞悎瑙勫墠鎻愪笅浣跨敤锛?

- 涓嶅緱鐢ㄤ簬渚电姱浠栦汉闅愮銆佺増鏉冩垨鍏朵粬鍚堟硶鏉冪泭
- 涓嶅緱鐢ㄤ簬浠讳綍杩濇硶杩濊鐢ㄩ€?
- 浣跨敤鑰呭簲鑷鎵挎媴鍥犱娇鐢ㄦ湰椤圭洰浜х敓鐨勫叏閮ㄩ闄╀笌璐ｄ换
- 濡傚钩鍙拌鍒欍€佹帴鍙ｇ瓥鐣ュ彉鏇村鑷村姛鑳藉け鏁堬紝灞炰簬姝ｅ父鎶€鏈闄?

濡傛灉浣犵户缁娇鐢ㄦ湰椤圭洰锛屽嵆瑙嗕负宸查槄璇诲苟鍚屾剰涓婅堪澹版槑銆?

## 璁稿彲璇?

鏈」鐩噰鐢?MIT License锛岃瑙?[LICENSE](./LICENSE)銆?

## 鍙嬫儏閾炬帴

- [LINUX DO](https://linux.do/)
