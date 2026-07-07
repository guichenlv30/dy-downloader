import { extractUrl, extractUrls, typeText } from "../api.js";

export default {
  name: "TaskComposer",
  props: {
    state: { type: Object, required: true },
  },
  emits: ["parse-url", "create-download", "create-batch", "create-live"],
  data() {
    return {
      tabs: [
        { key: "video", label: "视频下载" },
        { key: "batch", label: "批量下载" },
        { key: "live", label: "直播录制" },
      ],
    };
  },
  computed: {
    video() {
      return this.state.forms.video;
    },
    batch() {
      return this.state.forms.batch;
    },
    live() {
      return this.state.forms.live;
    },
    isParsedLive() {
      return this.video.parseResult?.supported && this.video.parseResult?.parsed?.type === "live";
    },
    parsedLabel() {
      return this.video.parseResult?.parsed?.type ? typeText(this.video.parseResult.parsed.type) : "未识别";
    },
  },
  methods: {
    extractUrl,
    extractUrls,
    resetParse() {
      this.video.parseResult = null;
      this.video.parseStatus = "等待输入";
    },
  },
  template: `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">工作台</h2>
          <div class="caption">粘贴链接后马上创建任务，直播会显示录制参数。</div>
        </div>
        <div class="tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="tab"
            :class="{ active: state.workbenchTab === tab.key }"
            type="button"
            @click="state.workbenchTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <div class="card-body stack" v-if="state.workbenchTab === 'video'">
        <textarea
          v-model="video.url"
          class="textarea"
          placeholder="粘贴抖音链接或完整分享文案"
          @input="resetParse"
        ></textarea>
        <div class="button-row">
          <button class="btn btn-secondary" type="button" @click="$emit('parse-url')">检测链接</button>
          <button class="btn btn-primary" type="button" @click="$emit('create-download')">开始下载</button>
        </div>
        <div class="card" style="box-shadow: none;">
          <div class="card-body">
            <div class="row">
              <strong>{{ video.parseResult ? (video.parseResult.supported ? '已识别' : '未识别') : video.parseStatus }}</strong>
              <span v-if="video.parseResult" class="badge">{{ parsedLabel }}</span>
            </div>
            <div class="caption" v-if="video.parseResult">{{ video.parseResult.url }}</div>
          </div>
        </div>
        <div v-if="isParsedLive" class="field-grid">
          <label class="field">最大录制秒数<input class="input" type="number" min="0" v-model.number="video.live.max_duration_seconds" /></label>
          <label class="field">空闲超时秒数<input class="input" type="number" min="1" v-model.number="video.live.idle_timeout_seconds" /></label>
          <label class="toggle"><input type="checkbox" v-model="video.live.convert_to_mp4" />录制后转 MP4</label>
          <label class="toggle"><input type="checkbox" v-model="video.live.keep_source_flv" />保留 FLV 源文件</label>
        </div>
      </div>

      <div class="card-body stack" v-else-if="state.workbenchTab === 'batch'">
        <textarea v-model="batch.text" class="textarea" style="min-height: 260px;" placeholder="每行一个链接或分享文案"></textarea>
        <div class="button-row">
          <button class="btn btn-primary" type="button" @click="$emit('create-batch')">批量创建</button>
        </div>
        <div class="caption">{{ batch.result }}</div>
      </div>

      <div class="card-body stack" v-else>
        <textarea v-model="live.url" class="textarea" placeholder="粘贴直播短链、live.douyin.com 链接或完整分享文案"></textarea>
        <div class="field-grid">
          <label class="field">最大录制秒数<input class="input" type="number" min="0" v-model.number="live.max_duration_seconds" /></label>
          <label class="field">空闲超时秒数<input class="input" type="number" min="1" v-model.number="live.idle_timeout_seconds" /></label>
          <label class="toggle"><input type="checkbox" v-model="live.convert_to_mp4" />录制后转 MP4</label>
          <label class="toggle"><input type="checkbox" v-model="live.keep_source_flv" />保留 FLV 源文件</label>
        </div>
        <div class="button-row">
          <button class="btn btn-primary" type="button" @click="$emit('create-live')">开始录制</button>
        </div>
      </div>
    </section>
  `,
};
