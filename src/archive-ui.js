'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const dom = {
    page: $('archive-page'),
    nodeTitle: $('archive-node-title'),
    subagents: $('archive-subagents'),
    jobs: $('archive-jobs'),
    subagentCount: $('archive-subagent-count'),
    jobCount: $('archive-job-count'),
    detail: $('archive-detail'),
    detailTitle: $('archive-detail-title'),
    detailMeta: $('archive-detail-meta'),
    detailOutput: $('archive-detail-output'),
    detailClose: $('archive-detail-close'),
  };
  if (!dom.page) return;

  let sessionId = '';
  let loading = false;
  let reloadTimer = 0;

  function archiveTime(value) {
    const ms = Number(value);
    if (!ms) return '';
    return new Date(ms).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function archiveDuration(start, end) {
    const from = Number(start);
    const to = Number(end);
    if (!from || !to || to < from) return '';
    const seconds = Math.max(0, Math.round((to - from) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return `${minutes}m ${rest}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function archiveStatusLabel(status) {
    const key = String(status || '').toLowerCase();
    if (key === 'done') return '完成';
    if (key === 'error') return '失败';
    if (key === 'cancelled' || key === 'canceled') return '已取消';
    if (key === 'timeout') return '超时';
    if (key === 'interrupted') return '已中断';
    if (key === 'running') return '运行中';
    return status || '完成';
  }

  function archiveEmpty(text) {
    return el('div', 'archive-empty', text);
  }

  function archiveRow({ title, meta, preview, onOpen }) {
    const row = el('button', 'archive-row');
    row.type = 'button';
    row.title = '双击查看';
    row.append(el('span', 'archive-row-title', title));
    const metaRow = el('span', 'archive-row-meta');
    for (const item of meta.filter(Boolean)) {
      metaRow.append(el('span', '', item));
    }
    row.append(metaRow);
    if (preview) row.append(el('span', 'archive-row-preview', preview));
    row.addEventListener('dblclick', onOpen);
    return row;
  }

  function renderSubagents(items) {
    dom.subagents.replaceChildren();
    dom.subagentCount.textContent = String(items.length);
    if (items.length === 0) {
      dom.subagents.append(archiveEmpty('还没有归档的子代理'));
      return;
    }
    for (const item of items) {
      dom.subagents.append(
        archiveRow({
          title: item.title || 'Subagent',
          meta: [
            archiveStatusLabel(item.status),
            item.messages ? `${item.messages} 条消息` : '',
            archiveTime(item.archivedAt),
          ],
          preview: String(item.preview || '').trim(),
          onOpen: () => {
            if (item.id) api.openChatWindow(item.id);
          },
        })
      );
    }
  }

  function renderJobs(items) {
    dom.jobs.replaceChildren();
    dom.jobCount.textContent = String(items.length);
    if (items.length === 0) {
      dom.jobs.append(archiveEmpty('还没有归档的后台任务'));
      return;
    }
    for (const item of items) {
      const exit =
        item.exitCode === null || item.exitCode === undefined
          ? ''
          : `exit ${item.exitCode}`;
      dom.jobs.append(
        archiveRow({
          title: item.note || item.command || item.id,
          meta: [
            archiveStatusLabel(item.status),
            archiveDuration(item.startedAt, item.endedAt),
            exit,
            archiveTime(item.endedAt),
          ],
          preview: String(item.outputPreview || item.stderrPreview || '').trim(),
          onOpen: () => void openJobDetail(item.id),
        })
      );
    }
  }

  function renderArchive(data) {
    const session = data?.session || null;
    dom.nodeTitle.textContent =
      session?.title ||
      state.sessions.find((item) => item.id === sessionId)?.title ||
      'Conversation';
    renderSubagents(Array.isArray(data?.subagents) ? data.subagents : []);
    renderJobs(Array.isArray(data?.jobs) ? data.jobs : []);
  }

  async function loadArchive() {
    if (!sessionId || loading) return;
    loading = true;
    try {
      const data = await api.loadArchive(sessionId);
      renderArchive(data);
    } catch (error) {
      console.error('load archive failed', error);
      dom.subagents.replaceChildren(archiveEmpty('归档加载失败'));
      dom.jobs.replaceChildren(archiveEmpty('归档加载失败'));
      dom.subagentCount.textContent = '0';
      dom.jobCount.textContent = '0';
    } finally {
      loading = false;
    }
  }

  function closeDetail() {
    dom.detail.classList.add('hidden');
    dom.detail.setAttribute('aria-hidden', 'true');
  }

  function appendDetailRow(label, value) {
    if (!value) return;
    const row = el('div', 'archive-detail-meta-row');
    row.append(el('span', 'archive-detail-meta-label', label));
    row.append(el('span', 'archive-detail-meta-value', value));
    dom.detailMeta.append(row);
  }

  async function openJobDetail(jobId) {
    if (!jobId) return;
    try {
      const data = await api.loadArchiveJob(sessionId, jobId);
      const job = data?.job;
      if (!job) return;
      dom.detailTitle.textContent = job.note || job.command || job.id;
      dom.detailMeta.replaceChildren();
      appendDetailRow('状态', archiveStatusLabel(job.status));
      appendDetailRow('命令', job.command);
      appendDetailRow('目录', job.cwd);
      appendDetailRow(
        '退出码',
        job.exitCode === null || job.exitCode === undefined
          ? ''
          : String(job.exitCode)
      );
      appendDetailRow(
        '耗时',
        archiveDuration(job.startedAt, job.endedAt)
      );
      appendDetailRow('开始', archiveTime(job.startedAt));
      appendDetailRow('结束', archiveTime(job.endedAt));
      if (job.truncated) appendDetailRow('输出', '已截断');
      const parts = [];
      if (job.output) parts.push(`--- stdout ---\n${job.output}`);
      if (job.stderr) parts.push(`--- stderr ---\n${job.stderr}`);
      dom.detailOutput.textContent = parts.join('\n\n') || '(无输出)';
      dom.detail.classList.remove('hidden');
      dom.detail.setAttribute('aria-hidden', 'false');
    } catch (error) {
      console.error('load archived task failed', error);
    }
  }

  function scheduleReload() {
    if (!state.archiveWindow || !sessionId) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void loadArchive(), 250);
  }

  function openArchivePage(id) {
    sessionId = String(id || '').trim();
    dom.page.classList.remove('hidden');
    dom.page.setAttribute('aria-hidden', 'false');
    const session = state.sessions.find((item) => item.id === sessionId);
    dom.nodeTitle.textContent = session?.title || 'Conversation';
    void loadArchive();
  }

  dom.detailClose?.addEventListener('click', closeDetail);
  dom.detail?.addEventListener('click', (event) => {
    if (event.target === dom.detail) closeDetail();
  });

  document.addEventListener(
    'keydown',
    (event) => {
      if (!state.archiveWindow) return;
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.code === 'Space' || event.key === ' ') {
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!dom.detail.classList.contains('hidden')) {
        closeDetail();
        return;
      }
      api.close();
    },
    true
  );

  api.onSubagentComplete(scheduleReload);
  api.onBackgroundComplete(scheduleReload);
  window.addEventListener('focus', scheduleReload);

  window.openArchivePage = openArchivePage;
})();
