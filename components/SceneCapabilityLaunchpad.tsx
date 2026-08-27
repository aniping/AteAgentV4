"use client";

import type { CSSProperties } from "react";
import {
  SCENES,
  getSceneAgentName,
  getSceneDescription,
  getSceneLabel,
  type SceneId,
} from "@/lib/scenes";

type LocalizedText = {
  zh: string;
  en: string;
};

type SceneCapabilityProfile = {
  missionSummary: LocalizedText;
  capabilities: readonly LocalizedText[];
  workflow: readonly LocalizedText[];
  deliverables: readonly LocalizedText[];
};

const SCENE_CAPABILITIES: Readonly<Record<SceneId, SceneCapabilityProfile>> = {
  requirements: {
    missionSummary: {
      zh: "把模糊想法变成可评审、可验收的工程需求",
      en: "Turn an ambiguous goal into reviewable, testable engineering requirements",
    },
    capabilities: [
      { zh: "目标与范围", en: "Goals and scope" },
      { zh: "约束与风险", en: "Constraints and risks" },
      { zh: "验收与追踪", en: "Acceptance and traceability" },
    ],
    workflow: [
      { zh: "理解目标", en: "Understand the goal" },
      { zh: "补齐约束", en: "Complete constraints" },
      { zh: "结构化整理", en: "Structure the requirements" },
      { zh: "一致性校验", en: "Check consistency" },
    ],
    deliverables: [
      { zh: "需求清单", en: "Requirements list" },
      { zh: "验收标准", en: "Acceptance criteria" },
      { zh: "待决问题", en: "Open questions" },
    ],
  },
  design: {
    missionSummary: {
      zh: "把确认需求变成跨系统可落地、可验证的工程方案",
      en: "Turn approved requirements into an implementable, verifiable system design",
    },
    capabilities: [
      { zh: "系统与射频架构", en: "System and RF architecture" },
      { zh: "接口与关键预算", en: "Interfaces and key budgets" },
      { zh: "方案权衡", en: "Design tradeoffs" },
    ],
    workflow: [
      { zh: "读取需求", en: "Read requirements" },
      { zh: "拆解架构", en: "Decompose the architecture" },
      { zh: "完成权衡", en: "Resolve tradeoffs" },
      { zh: "形成设计基线", en: "Create the design baseline" },
    ],
    deliverables: [
      { zh: "总体方案", en: "Overall design" },
      { zh: "接口定义", en: "Interface definitions" },
      { zh: "设计决策", en: "Design decisions" },
    ],
  },
  development: {
    missionSummary: {
      zh: "把工程方案转化为可回退、可测试的软硬件实现",
      en: "Turn the engineering plan into testable, reversible implementation",
    },
    capabilities: [
      { zh: "软件与固件", en: "Software and firmware" },
      { zh: "自动化与工程资料", en: "Automation and artifacts" },
      { zh: "异常与可观测性", en: "Errors and observability" },
    ],
    workflow: [
      { zh: "读取上下文", en: "Read context" },
      { zh: "制定改动", en: "Plan the change" },
      { zh: "编写实现", en: "Implement" },
      { zh: "验证结果", en: "Verify results" },
    ],
    deliverables: [
      { zh: "可运行实现", en: "Working implementation" },
      { zh: "验证记录", en: "Verification record" },
      { zh: "变更说明", en: "Change notes" },
    ],
  },
  integration: {
    missionSummary: {
      zh: "用证据快速缩小范围，定位跨系统故障的真正根因",
      en: "Use evidence to narrow the search and isolate cross-system root causes",
    },
    capabilities: [
      { zh: "复现与数据对齐", en: "Reproduction and data alignment" },
      { zh: "分层诊断", en: "Layered diagnosis" },
      { zh: "最小证伪实验", en: "Minimal falsification tests" },
    ],
    workflow: [
      { zh: "对齐现象", en: "Align observations" },
      { zh: "建立假设", en: "Build hypotheses" },
      { zh: "最小化验证", en: "Run minimal tests" },
      { zh: "收敛根因", en: "Converge on the root cause" },
    ],
    deliverables: [
      { zh: "根因证据", en: "Root-cause evidence" },
      { zh: "修复建议", en: "Fix recommendations" },
      { zh: "回归范围", en: "Regression scope" },
    ],
  },
  testing: {
    missionSummary: {
      zh: "建立从工程需求到可复核验证证据的完整闭环",
      en: "Create a traceable loop from requirements to reviewable evidence",
    },
    capabilities: [
      { zh: "测试策略与覆盖", en: "Test strategy and coverage" },
      { zh: "边界与异常", en: "Boundaries and failures" },
      { zh: "证据与追踪", en: "Evidence and traceability" },
    ],
    workflow: [
      { zh: "识别风险", en: "Identify risks" },
      { zh: "设计覆盖", en: "Design coverage" },
      { zh: "执行验证", en: "Run verification" },
      { zh: "沉淀证据", en: "Record evidence" },
    ],
    deliverables: [
      { zh: "测试报告", en: "Test report" },
      { zh: "覆盖矩阵", en: "Coverage matrix" },
      { zh: "缺陷清单", en: "Defect list" },
    ],
  },
};

function isChineseLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

function localize(value: LocalizedText, locale: string): string {
  return isChineseLocale(locale) ? value.zh : value.en;
}

export function SceneCapabilityLaunchpad({
  activeSceneId,
  locale,
  onSceneChange,
}: {
  activeSceneId: SceneId;
  locale: string;
  onSceneChange: (sceneId: SceneId) => void;
}) {
  const activeScene = SCENES.find((scene) => scene.id === activeSceneId) ?? SCENES[0];
  const profile = SCENE_CAPABILITIES[activeScene.id];
  const isZh = isChineseLocale(locale);
  const sceneStyle = { "--scene-accent": activeScene.accent } as CSSProperties;

  return (
    <section className="scene-capability-launchpad" style={sceneStyle} aria-labelledby="scene-capability-title">
      <header className="scene-capability-heading">
        <div>
          <span className="scene-capability-eyebrow">{isZh ? "五大工程场景" : "Five engineering scenes"}</span>
          <h1 id="scene-capability-title">{isZh ? "先选场景，再开始任务" : "Choose a scene, then start the task"}</h1>
        </div>
        <p>{isZh ? "每个 Agent 的职责、工作方式和默认交付都在首屏展开。" : "See each Agent's role, approach, and default outputs before you begin."}</p>
      </header>

      <nav className="scene-capability-deck" aria-label={isZh ? "选择工程场景" : "Choose an engineering scene"}>
        {SCENES.map((scene, index) => {
          const itemProfile = SCENE_CAPABILITIES[scene.id];
          const active = scene.id === activeScene.id;
          return (
            <button
              key={scene.id}
              type="button"
              className={`scene-capability-card${active ? " scene-capability-card--active" : ""}`}
              style={{ "--scene-card-accent": scene.accent } as CSSProperties}
              aria-pressed={active}
              onClick={() => onSceneChange(scene.id)}
            >
              <span className="scene-capability-card-number">{String(index + 1).padStart(2, "0")}</span>
              <strong>{getSceneLabel(scene, locale)}</strong>
              {active && <span className="scene-capability-current">{isZh ? "当前" : "Active"}</span>}
              <p>{getSceneDescription(scene, locale)}</p>
              <span className="scene-capability-output">
                {isZh ? "交付" : "Output"} · {localize(itemProfile.deliverables[0], locale)}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="scene-capability-detail">
        <div className="scene-capability-summary">
          <span>{isZh ? "当前 Agent" : "Current Agent"}</span>
          <strong>{getSceneAgentName(activeScene, locale)}</strong>
          <p>{localize(profile.missionSummary, locale)}</p>
        </div>

        <div className="scene-capability-groups">
          <section>
            <h2>{isZh ? "擅长解决" : "Best at"}</h2>
            <ul>
              {profile.capabilities.map((item) => <li key={item.zh}>{localize(item, locale)}</li>)}
            </ul>
          </section>
          <section>
            <h2>{isZh ? "Agent 会怎么做" : "How it works"}</h2>
            <ol>
              {profile.workflow.map((item, index) => (
                <li key={item.zh}><span>{String(index + 1).padStart(2, "0")}</span>{localize(item, locale)}</li>
              ))}
            </ol>
          </section>
          <section>
            <h2>{isZh ? "默认交付" : "Default outputs"}</h2>
            <ul>
              {profile.deliverables.map((item) => <li key={item.zh}>{localize(item, locale)}</li>)}
            </ul>
          </section>
        </div>
      </div>
    </section>
  );
}
