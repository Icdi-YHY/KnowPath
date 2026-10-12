import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import clsx from 'clsx';
import { LayoutGrid, Maximize2, MessageSquare, RefreshCw, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { mainlineNumbers } from '@/services/layout';
import { useStore } from '@/store/useStore';
import { MergePanel } from './MergePanel';
import { NodeCard, type ThreadNodeData } from './NodeCard';
import { EmptyState, Markdown, Spinner, StatusDot } from './ui';

const nodeTypes: NodeTypes = { thread: NodeCard };

function GraphInner() {
  const nodes = useStore((s) => s.nodes);
  const crossLinks = useStore((s) => s.crossLinks);
  const activeNodeId = useStore((s) => s.activeNodeId);
  const selectNode = useStore((s) => s.selectNode);
  const moveNode = useStore((s) => s.moveNode);
  const applyLayout = useStore((s) => s.applyLayout);
  const generateMainline = useStore((s) => s.generateMainline);
  const busy = useStore((s) => s.busy);
  const { fitView } = useReactFlow();

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node<ThreadNodeData>>([]);

  // 组件卸载后不能再碰 React Flow 实例，否则会访问已销毁的 DOM 而报错
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canvasRef = useRef<HTMLDivElement>(null);

  const fit = () => {
    if (!mountedRef.current) return;
    // 画布还没量出尺寸时 fitView 会退化到最小倍率，把整张图缩成一小团，直接跳过
    const el = canvasRef.current;
    if (!el || el.clientWidth < 240 || el.clientHeight < 200) return;
    fitView({ padding: 0.22, duration: 260, minZoom: 0.3, maxZoom: 1.05 });
  };
  const nodeKey = useMemo(() => nodes.map((n) => n.id).join(','), [nodes]);
  const panelOpen = !!activeNodeId;

  // 挂载 / 节点集合变化后，等布局测量稳定再适配视口
  useEffect(() => {
    if (!nodes.length) return;
    const t = setTimeout(fit, 140);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]);

  // 详情面板展开/收起会改变画布宽度，重新适配一次，
  // 否则刚新建的支线（排在父节点右侧，也就是最右边）会被挤出视野
  useEffect(() => {
    if (!nodes.length) return;
    const t = setTimeout(fit, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  /** 主线显示序号（前序遍历），分叉后依然按阅读顺序连续编号 */
  const numbers = useMemo(() => mainlineNumbers(nodes), [nodes]);

  const rfNodes = useMemo<Node<ThreadNodeData>[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'thread',
        position: { x: n.x, y: n.y },
        data: { node: n, active: n.id === activeNodeId, index: numbers.get(n.id) },
      })),
    [nodes, activeNodeId, numbers],
  );

  useEffect(() => {
    setFlowNodes(rfNodes);
  }, [rfNodes, setFlowNodes]);

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    const ids = new Set(nodes.map((n) => n.id));

    // 结构线：统一是「父 → 子」。主线之间的连线是蓝色脉络，挂到支线的是灰色
    for (const n of nodes) {
      if (!n.parentId || !ids.has(n.parentId)) continue;
      const isMainline = n.kind === 'main';
      out.push({
        id: `p-${n.parentId}-${n.id}`,
        source: n.parentId,
        target: n.id,
        sourceHandle: 'r',
        targetHandle: 'l',
        type: 'smoothstep',
        style: isMainline
          ? { stroke: '#5b8cff', strokeWidth: 2.5 }
          : { stroke: '#22d3a6', strokeWidth: 2, opacity: 0.65 },
      });
    }
    for (const c of crossLinks) {
      // 关联线两端的节点必须都存在。否则 React Flow 会拿到指向不存在节点的边，
      // 计算位置时抛 "Cannot read properties of null (reading 'getBoundingClientRect')"
      if (!ids.has(c.sourceId) || !ids.has(c.targetId)) continue;
      out.push({
        id: `c-${c.id}`,
        source: c.sourceId,
        target: c.targetId,
        sourceHandle: 'r',
        targetHandle: 'l',
        type: 'default',
        animated: true,
        label: c.reason,
        labelStyle: { fill: '#7fe3c4', fontSize: 11 },
        labelBgStyle: { fill: '#0b1020', fillOpacity: 0.85 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#22d3a6' },
        style: { stroke: '#22d3a6', strokeWidth: 1.8, strokeDasharray: '6 4' },
      });
    }
    return out;
  }, [nodes, crossLinks]);

  const active = nodes.find((n) => n.id === activeNodeId) ?? null;

  if (!nodes.length) {
    return (
      <EmptyState
        icon={<Sparkles size={34} />}
        title="还没有学习主线"
        desc="先在「知识库」里放入你的学习材料，然后让 AI 为你生成一条从零到掌握的主线学习路径。"
        action={
          <button className="btn-primary" onClick={generateMainline} disabled={busy === 'mainline'}>
            {busy === 'mainline' ? <Spinner /> : <Wand2 size={15} />} 一键生成主线
          </button>
        }
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <MergePanel />

      {/* 桌面端：详情面板占据真实宽度，不遮挡画布；移动端：仍是底部浮层 */}
      <div className="flex min-h-0 flex-1">
        <div ref={canvasRef} className="relative min-h-0 flex-1">
        <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
        <button className="btn-ghost !py-1.5 !text-xs" onClick={() => applyLayout()}>
          <LayoutGrid size={14} /> 自动排版
        </button>
        <button
          className="btn-ghost !py-1.5 !text-xs"
          onClick={() => fitView({ padding: 0.22, duration: 320, minZoom: 0.42, maxZoom: 1.05 })}
        >
          <Maximize2 size={14} /> 适应
        </button>
        <button
          className="btn-ghost !py-1.5 !text-xs"
          onClick={generateMainline}
          disabled={busy === 'mainline'}
        >
          {busy === 'mainline' ? <Spinner /> : <Wand2 size={14} />} 重新生成主线
        </button>
      </div>

      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => selectNode(n.id)}
        onNodeDragStop={(_, n) => moveNode(n.id, n.position.x, n.position.y)}
        onInit={() => setTimeout(fit, 160)}
        minZoom={0.25}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        className="bg-ink-950"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1b2740" />
        <Controls
          showInteractive={false}
          className="!bg-ink-850 !border-ink-700 [&>button]:!bg-ink-850 [&>button]:!border-ink-700 [&>button]:!text-ink-200 [&>button:hover]:!bg-ink-700"
        />
      </ReactFlow>
        </div>

        {active && <NodeDetail nodeId={active.id} onClose={() => selectNode(null)} />}
      </div>
    </div>
  );
}

function NodeDetail({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const nodes = useStore((s) => s.nodes);
  const node = nodes.find((n) => n.id === nodeId);
  const busy = useStore((s) => s.busy);
  const streaming = useStore((s) => s.streaming);
  const regenerateNode = useStore((s) => s.regenerateNode);
  const deleteNode = useStore((s) => s.deleteNode);
  const setNodeStatus = useStore((s) => s.setNodeStatus);
  const addBranch = useStore((s) => s.addBranch);
  const setView = useStore((s) => s.setView);
  const selectNode = useStore((s) => s.selectNode);
  const [question, setQuestion] = useState('');
  const [showBranch, setShowBranch] = useState(false);
  const numbers = useMemo(() => mainlineNumbers(nodes), [nodes]);

  if (!node) return null;
  const isStreaming = streaming?.nodeId === nodeId && streaming.kind === 'explain';
  const content = isStreaming ? streaming!.content : node.content;
  const isMain = node.kind === 'main';

  return (
    <div
      className={clsx(
        // 移动端：从底部弹出的浮层
        'absolute z-20 bottom-0 left-0 right-0 max-h-[62%]',
        // 桌面端：改成占据真实宽度的右侧栏，避免盖住画布最右边那一列节点
        'sm:static sm:z-auto sm:max-h-full sm:h-full sm:w-[420px] sm:shrink-0',
        'bg-ink-900/95 backdrop-blur border-ink-700 border-t sm:border-t-0 sm:border-l',
        'flex flex-col animate-fade-in',
      )}
    >
      <div className="flex items-start gap-2 px-4 py-3 border-b border-ink-700/70">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isMain ? (
              <span className="chip bg-brand-500/15 text-brand-400">
                主线 {numbers.get(nodeId) ?? node.order + 1}
              </span>
            ) : node.kind === 'branch' ? (
              <span className="chip bg-emerald-500/15 text-emerald-300">支线</span>
            ) : (
              <span className="chip bg-amber-500/15 text-amber-300">资料</span>
            )}
            {node.kind !== 'source' && (
              <button
                className="chip bg-ink-800 text-ink-300 hover:text-white"
                onClick={() =>
                  setNodeStatus(nodeId, node.status === 'done' ? 'todo' : node.status === 'todo' ? 'learning' : 'done')
                }
              >
                <StatusDot status={node.status} />
                {node.status === 'done' ? '已完成' : node.status === 'learning' ? '学习中' : '未开始'}
              </button>
            )}
          </div>
          <div className="font-semibold text-white leading-snug">{node.title}</div>
          {node.summary && <div className="text-xs text-ink-400 mt-1">{node.summary}</div>}
        </div>
        <button className="btn-ghost !p-1.5" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-ink-700/70">
        <button
          className="btn-primary !py-1.5 !text-xs"
          onClick={() => {
            selectNode(nodeId);
            setView('chat');
          }}
        >
          <MessageSquare size={14} /> 沉浸对话
        </button>
        <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setShowBranch((v) => !v)}>
          <Sparkles size={14} /> 这里我不懂
        </button>
        <button
          className="btn-ghost !py-1.5 !text-xs"
          onClick={() => regenerateNode(nodeId)}
          disabled={busy === `explain:${nodeId}`}
        >
          {busy === `explain:${nodeId}` ? <Spinner /> : <RefreshCw size={14} />} 重新讲解
        </button>
        <button className="btn-danger !py-1.5 !text-xs ml-auto" onClick={() => deleteNode(nodeId)}>
          <Trash2 size={14} /> 删除
        </button>
      </div>

      {showBranch && (
        <div className="px-4 py-3 border-b border-ink-700/70 bg-ink-850/60">
          <div className="text-xs text-ink-300 mb-2">
            描述你具体卡在哪里，AI 会为它单独开一条支线，并自动连回主线相关知识点。
          </div>
          <div className="flex gap-2">
            <input
              className="input"
              autoFocus
              placeholder="例如：为什么 HTTP 是无状态的？"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && question.trim()) {
                  addBranch(nodeId, question.trim());
                  setQuestion('');
                  setShowBranch(false);
                }
              }}
            />
            <button
              className="btn-primary shrink-0"
              disabled={!question.trim() || busy === `branch:${nodeId}`}
              onClick={() => {
                addBranch(nodeId, question.trim());
                setQuestion('');
                setShowBranch(false);
              }}
            >
              {busy === `branch:${nodeId}` ? <Spinner /> : '开'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {content ? (
          <>
            <Markdown>{content}</Markdown>
            {isStreaming && <span className="inline-block w-2 h-4 bg-brand-500 animate-blink align-text-bottom" />}
          </>
        ) : (
          <div className="text-sm text-ink-400 py-8 text-center">
            还没有讲解内容，点击上方「重新讲解」让 AI 从零讲透。
          </div>
        )}
      </div>
    </div>
  );
}

export function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}
