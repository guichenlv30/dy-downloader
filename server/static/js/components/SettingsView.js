export default {
  name: "SettingsView",
  props: {
    form: { type: Object, required: true },
    config: { type: Object, default: null },
    account: { type: Object, required: true },
  },
  emits: ["save-settings", "login", "clear-cookies"],
  template: `
    <section class="stack">
      <section class="card settings-section">
        <div class="card-header">
          <div>
            <h2 class="card-title">命名与目录</h2>
            <div class="caption">按行组织设置，保存后写入现有配置接口。</div>
          </div>
          <button class="btn btn-primary" type="button" @click="$emit('save-settings')">保存设置</button>
        </div>
        <div class="card-body">
          <div class="settings-row">
            <div>
              <strong>数据目录</strong>
              <div class="caption">数据库、Cookie、缓存数据</div>
            </div>
            <input class="input" v-model="form.data_dir" />
          </div>
          <div class="settings-row">
            <div>
              <strong>下载目录</strong>
              <div class="caption">作品和直播文件保存位置</div>
            </div>
            <input class="input" v-model="form.path" />
          </div>
          <div class="settings-row">
            <div>
              <strong>作者目录</strong>
              <div class="caption">控制作者文件夹命名方式</div>
            </div>
            <select class="select" v-model="form.author_dir">
              <option value="nickname">昵称</option>
              <option value="sec_uid">Sec UID</option>
              <option value="nickname_uid">昵称 + UID</option>
              <option value="user_sec_uid">user_sec_uid</option>
            </select>
          </div>
          <div class="settings-row">
            <div><strong>文件模板</strong><div class="caption">{date} {title} {id}</div></div>
            <input class="input" v-model="form.filename_template" />
          </div>
          <div class="settings-row">
            <div><strong>文件夹模板</strong><div class="caption">单作品文件夹名称</div></div>
            <input class="input" v-model="form.folder_template" />
          </div>
        </div>
      </section>

      <section class="card settings-section">
        <div class="card-header">
          <div>
            <h2 class="card-title">下载与账号</h2>
            <div class="caption">沿用当前 FastAPI 配置字段。</div>
          </div>
          <div class="button-row">
            <button class="btn btn-secondary" type="button" @click="$emit('login')">一键登录抖音</button>
            <button class="btn btn-danger" type="button" @click="$emit('clear-cookies')">清除登录状态</button>
          </div>
        </div>
        <div class="card-body">
          <div class="settings-row">
            <div><strong>当前账号</strong><div class="caption">确认正在使用哪个抖音账号</div></div>
            <div class="account-summary">
              <span class="avatar small">
                <img v-if="account.profile?.avatar" :src="account.profile.avatar" alt="" referrerpolicy="no-referrer" />
                <span v-else>{{ account.profile?.nickname ? account.profile.nickname.slice(0, 1) : '抖' }}</span>
              </span>
              <span>
                <strong>{{ account.profile?.nickname || account.label }}</strong>
                <small>{{ account.detail || account.error || '未获取账号详情' }}</small>
              </span>
            </div>
          </div>
          <div class="settings-row">
            <div><strong>线程数</strong><div class="caption">并发下载数量</div></div>
            <input class="input" type="number" min="1" max="64" v-model.number="form.thread" />
          </div>
          <div class="settings-row">
            <div><strong>限速</strong><div class="caption">请求节流，避免过快</div></div>
            <input class="input" type="number" min="0.1" step="0.1" v-model.number="form.rate_limit" />
          </div>
          <div class="settings-row">
            <div><strong>重试次数</strong><div class="caption">失败后重试次数</div></div>
            <input class="input" type="number" min="0" max="20" v-model.number="form.retry_times" />
          </div>
          <div class="settings-row">
            <div><strong>代理</strong><div class="caption">例如 http://127.0.0.1:7890</div></div>
            <input class="input" v-model="form.proxy" />
          </div>
          <div class="settings-row">
            <div><strong>媒体附件</strong><div class="caption">音乐、封面、头像、JSON、文案</div></div>
            <div class="row">
              <label class="toggle"><input type="checkbox" v-model="form.music" />音乐</label>
              <label class="toggle"><input type="checkbox" v-model="form.cover" />封面</label>
              <label class="toggle"><input type="checkbox" v-model="form.avatar" />头像</label>
              <label class="toggle"><input type="checkbox" v-model="form.json" />JSON</label>
              <label class="toggle"><input type="checkbox" v-model="form.save_desc" />保存文案</label>
            </div>
          </div>
          <div class="settings-row">
            <div><strong>评论采集</strong><div class="caption">下载作品时额外保存评论 JSON</div></div>
            <div class="field-grid">
              <label class="toggle"><input type="checkbox" v-model="form.comments_enabled" />采集评论</label>
              <label class="toggle"><input type="checkbox" v-model="form.comments_include_replies" />包含评论回复</label>
              <label class="field">评论上限<input class="input" type="number" min="0" v-model.number="form.comments_max" /></label>
              <label class="field">每页数量<input class="input" type="number" min="1" v-model.number="form.comments_page_size" /></label>
            </div>
          </div>
          <div class="settings-row">
            <div><strong>直播默认值</strong><div class="caption">工作台直播录制默认参数</div></div>
            <div class="field-grid">
              <input class="input" type="number" min="0" v-model.number="form.live_max_duration" />
              <input class="input" type="number" min="1" v-model.number="form.live_idle_timeout" />
              <label class="toggle"><input type="checkbox" v-model="form.live_convert_to_mp4" />转 MP4</label>
              <label class="toggle"><input type="checkbox" v-model="form.live_keep_source_flv" />保留 FLV</label>
            </div>
          </div>
        </div>
      </section>
    </section>
  `,
};
