/**
 * Shape / edge style presets for the draw.io semantic agent layer.
 * ArchiMate styles mirror bundled draw.io Archimate 3.2 sidebar templates.
 */

export const BASIC_SHAPES = [
  "rectangle",
  "rounded",
  "ellipse",
  "rhombus",
  "cylinder",
  "actor",
  "text",
  "group",
  "swimlane",
] as const;

export const ARCHIMATE_SHAPES = [
  // Business
  "archimate.business_actor",
  "archimate.business_role",
  "archimate.business_collaboration",
  "archimate.business_interface",
  "archimate.business_process",
  "archimate.business_function",
  "archimate.business_interaction",
  "archimate.business_event",
  "archimate.business_service",
  "archimate.business_object",
  "archimate.contract",
  "archimate.representation",
  "archimate.product",
  // Application
  "archimate.application_component",
  "archimate.application_collaboration",
  "archimate.application_interface",
  "archimate.application_function",
  "archimate.application_interaction",
  "archimate.application_process",
  "archimate.application_event",
  "archimate.application_service",
  "archimate.data_object",
  // Technology
  "archimate.node",
  "archimate.device",
  "archimate.system_software",
  "archimate.technology_collaboration",
  "archimate.technology_interface",
  "archimate.path",
  "archimate.communication_network",
  "archimate.technology_function",
  "archimate.technology_process",
  "archimate.technology_interaction",
  "archimate.technology_event",
  "archimate.technology_service",
  "archimate.artifact",
  "archimate.equipment",
  "archimate.facility",
  "archimate.distribution_network",
  "archimate.material",
  // Motivation
  "archimate.stakeholder",
  "archimate.driver",
  "archimate.assessment",
  "archimate.goal",
  "archimate.outcome",
  "archimate.principle",
  "archimate.requirement",
  "archimate.constraint",
  "archimate.meaning",
  "archimate.value",
  // Strategy
  "archimate.resource",
  "archimate.capability",
  "archimate.value_stream",
  "archimate.course_of_action",
  // Implementation & Migration
  "archimate.work_package",
  "archimate.deliverable",
  "archimate.implementation_event",
  "archimate.plateau",
  "archimate.gap",
  // Generic / location
  "archimate.location",
  "archimate.grouping",
] as const;

export const DRAWIO_SHAPES = [...BASIC_SHAPES, ...ARCHIMATE_SHAPES] as const;
export type DrawioShape = (typeof DRAWIO_SHAPES)[number];

export const DRAWIO_RELATIONS = [
  "default",
  "orthogonal",
  "composition",
  "aggregation",
  "assignment",
  "realization",
  "serving",
  "access",
  "influence",
  "association",
  "triggering",
  "flow",
  "specialization",
] as const;
export type DrawioRelation = (typeof DRAWIO_RELATIONS)[number];

const AM = "html=1;outlineConnect=0;whiteSpace=wrap;shape=mxgraph.archimate3.";

function am(
  fill: string,
  appType: string,
  archiType: "square" | "rounded" | "oct" | "",
): string {
  const archi = archiType ? `archiType=${archiType};` : "";
  return `${AM}application;appType=${appType};${archi}fillColor=${fill};`;
}

/** Preset mx style strings (must end with `;` when non-empty). */
export const SHAPE_STYLES: Record<DrawioShape, string> = {
  rectangle: "rounded=0;whiteSpace=wrap;html=1;",
  rounded: "rounded=1;whiteSpace=wrap;html=1;",
  ellipse: "ellipse;whiteSpace=wrap;html=1;aspect=fixed;",
  rhombus: "rhombus;whiteSpace=wrap;html=1;",
  cylinder:
    "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;",
  actor:
    "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;",
  text: "text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;",
  group:
    "group;container=1;resizable=1;collapsible=0;recursiveResize=0;dropTarget=0;",
  swimlane:
    "swimlane;startSize=30;html=1;whiteSpace=wrap;container=1;collapsible=0;",

  // Business (#ffff99)
  "archimate.business_actor": am("#ffff99", "actor", "square"),
  "archimate.business_role": am("#ffff99", "role", "square"),
  "archimate.business_collaboration": am("#ffff99", "collab", "square"),
  "archimate.business_interface": am("#ffff99", "interface", "square"),
  "archimate.business_process": am("#ffff99", "proc", "rounded"),
  "archimate.business_function": am("#ffff99", "func", "rounded"),
  "archimate.business_interaction": am("#ffff99", "interaction", "rounded"),
  "archimate.business_event": am("#ffff99", "event", "rounded"),
  "archimate.business_service": am("#ffff99", "serv", "rounded"),
  "archimate.business_object": am("#ffff99", "passive", "square"),
  "archimate.contract": am("#ffff99", "contract", "square"),
  "archimate.representation": am("#ffff99", "representation", "square"),
  "archimate.product": am("#ffff99", "product", "square"),

  // Application (#99ffff)
  "archimate.application_component": am("#99ffff", "comp", "square"),
  "archimate.application_collaboration": am("#99ffff", "collab", "square"),
  "archimate.application_interface": am("#99ffff", "interface", "square"),
  "archimate.application_function": am("#99ffff", "func", "rounded"),
  "archimate.application_interaction": am("#99ffff", "interaction", "rounded"),
  "archimate.application_process": am("#99ffff", "proc", "rounded"),
  "archimate.application_event": am("#99ffff", "event", "rounded"),
  "archimate.application_service": am("#99ffff", "serv", "rounded"),
  "archimate.data_object": am("#99ffff", "passive", "square"),

  // Technology (#AFFFAF)
  "archimate.node": am("#AFFFAF", "node", "square"),
  "archimate.device": am("#AFFFAF", "device", ""),
  "archimate.system_software": am("#AFFFAF", "sysSw", "square"),
  "archimate.technology_collaboration": am("#AFFFAF", "collab", "square"),
  "archimate.technology_interface": am("#AFFFAF", "interface", "square"),
  "archimate.path": am("#AFFFAF", "path", "square"),
  "archimate.communication_network": am("#AFFFAF", "netw", "square"),
  "archimate.technology_function": am("#AFFFAF", "func", "square"),
  "archimate.technology_process": am("#AFFFAF", "proc", "rounded"),
  "archimate.technology_interaction": am("#AFFFAF", "interaction", "rounded"),
  "archimate.technology_event": am("#AFFFAF", "event", "rounded"),
  "archimate.technology_service": am("#AFFFAF", "serv", "rounded"),
  "archimate.artifact": am("#AFFFAF", "artifact", "square"),
  "archimate.equipment": am("#AFFFAF", "equipment", "square"),
  "archimate.facility": am("#AFFFAF", "facility", "square"),
  "archimate.distribution_network": am("#AFFFAF", "distribution", "square"),
  "archimate.material": am("#AFFFAF", "material", "square"),

  // Motivation (#CCCCFF)
  "archimate.stakeholder": am("#CCCCFF", "role", "oct"),
  "archimate.driver": am("#CCCCFF", "driver", "oct"),
  "archimate.assessment": am("#CCCCFF", "assess", "oct"),
  "archimate.goal": am("#CCCCFF", "goal", "oct"),
  "archimate.outcome": am("#CCCCFF", "outcome", "oct"),
  "archimate.principle": am("#CCCCFF", "principle", "oct"),
  "archimate.requirement": am("#CCCCFF", "requirement", "oct"),
  "archimate.constraint": am("#CCCCFF", "constraint", "oct"),
  "archimate.meaning": am("#CCCCFF", "meaning", "oct"),
  "archimate.value": am("#CCCCFF", "amValue", "oct"),

  // Strategy (#F5DEAA)
  "archimate.resource": am("#F5DEAA", "resource", "square"),
  "archimate.capability": am("#F5DEAA", "capability", "rounded"),
  "archimate.value_stream": am("#F5DEAA", "valueStream", "rounded"),
  "archimate.course_of_action": am("#F5DEAA", "course", "rounded"),

  // Implementation (#FFE0E0)
  "archimate.work_package": am("#FFE0E0", "workPackage", "rounded"),
  "archimate.deliverable": am("#FFE0E0", "deliverable", ""),
  "archimate.implementation_event": am("#FFE0E0", "event", "rounded"),
  "archimate.plateau": am("#FFE0E0", "plateau", ""),
  "archimate.gap": am("#FFE0E0", "gap", ""),

  "archimate.location":
    "html=1;outlineConnect=0;whiteSpace=wrap;shape=mxgraph.archimate3.application;appType=location;archiType=square;fillColor=#efd1e4;",
  "archimate.grouping":
    "html=1;outlineConnect=0;whiteSpace=wrap;shape=mxgraph.archimate3.application;appType=grouping;archiType=square;dashed=1;fillColor=none;container=1;",
};

export const DEFAULT_SHAPE_SIZE: Partial<
  Record<DrawioShape, { width: number; height: number }>
> = {
  actor: { width: 40, height: 80 },
  text: { width: 80, height: 30 },
  group: { width: 320, height: 240 },
  swimlane: { width: 320, height: 240 },
  "archimate.grouping": { width: 320, height: 240 },
};

export const DEFAULT_ARCHIMATE_SIZE = { width: 150, height: 75 };

export function defaultSizeForShape(shape: DrawioShape): {
  width: number;
  height: number;
} {
  if (DEFAULT_SHAPE_SIZE[shape]) return DEFAULT_SHAPE_SIZE[shape]!;
  if (shape.startsWith("archimate.")) return DEFAULT_ARCHIMATE_SIZE;
  return { width: 120, height: 60 };
}

export const DEFAULT_EDGE_STYLE =
  "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;";

export const RELATION_STYLES: Record<DrawioRelation, string> = {
  default: DEFAULT_EDGE_STYLE,
  orthogonal: DEFAULT_EDGE_STYLE,
  composition:
    "html=1;startArrow=diamondThin;startFill=1;edgeStyle=elbowEdgeStyle;elbow=vertical;startSize=10;endArrow=none;endFill=0;",
  aggregation:
    "html=1;startArrow=diamondThin;startFill=0;edgeStyle=elbowEdgeStyle;elbow=vertical;startSize=10;endArrow=none;endFill=0;",
  assignment:
    "endArrow=block;html=1;endFill=1;startArrow=oval;startFill=1;edgeStyle=elbowEdgeStyle;elbow=vertical;",
  realization:
    "edgeStyle=elbowEdgeStyle;html=1;endArrow=block;elbow=vertical;endFill=0;dashed=1;",
  serving:
    "edgeStyle=elbowEdgeStyle;html=1;endArrow=open;elbow=vertical;endFill=1;",
  access:
    "edgeStyle=elbowEdgeStyle;html=1;endArrow=open;elbow=vertical;endFill=0;dashed=1;dashPattern=1 4;",
  influence:
    "edgeStyle=elbowEdgeStyle;html=1;endArrow=open;elbow=vertical;endFill=0;dashed=1;dashPattern=6 4;",
  association:
    "edgeStyle=elbowEdgeStyle;html=1;endArrow=none;elbow=vertical;",
  triggering:
    "edgeStyle=elbowEdgeStyle;html=1;endArrow=block;dashed=0;elbow=vertical;endFill=1;",
  flow: "edgeStyle=elbowEdgeStyle;html=1;endArrow=block;dashed=1;elbow=vertical;endFill=1;dashPattern=6 4;",
  specialization:
    "endArrow=block;html=1;endFill=0;edgeStyle=elbowEdgeStyle;elbow=vertical;",
};

export function isDrawioShape(v: string): v is DrawioShape {
  return (DRAWIO_SHAPES as readonly string[]).includes(v);
}

export function isDrawioRelation(v: string): v is DrawioRelation {
  return (DRAWIO_RELATIONS as readonly string[]).includes(v);
}

/** Top → bottom order for ArchiMate viewpoint layouts. */
export type ArchimateLayer =
  | "motivation"
  | "strategy"
  | "business"
  | "application"
  | "technology"
  | "implementation"
  | "other";

export const ARCHIMATE_LAYER_ORDER: readonly ArchimateLayer[] = [
  "motivation",
  "strategy",
  "business",
  "application",
  "technology",
  "implementation",
  "other",
] as const;

const FILL_TO_LAYER: Record<string, ArchimateLayer> = {
  "#ccccff": "motivation",
  "#f5deaa": "strategy",
  "#ffff99": "business",
  "#99ffff": "application",
  "#afffaf": "technology",
  "#ffe0e0": "implementation",
  "#efd1e4": "other",
};

const APP_TYPE_TO_LAYER: Record<string, ArchimateLayer> = {
  // motivation
  driver: "motivation",
  assess: "motivation",
  goal: "motivation",
  outcome: "motivation",
  principle: "motivation",
  requirement: "motivation",
  constraint: "motivation",
  meaning: "motivation",
  amvalue: "motivation",
  // strategy
  resource: "strategy",
  capability: "strategy",
  valuestream: "strategy",
  course: "strategy",
  // business (role/actor often business; stakeholder uses role+oct → fill wins)
  actor: "business",
  role: "business",
  contract: "business",
  representation: "business",
  product: "business",
  // application
  comp: "application",
  passive: "application",
  // technology
  node: "technology",
  device: "technology",
  syssw: "technology",
  path: "technology",
  netw: "technology",
  artifact: "technology",
  equipment: "technology",
  facility: "technology",
  distribution: "technology",
  material: "technology",
  // implementation
  workpackage: "implementation",
  deliverable: "implementation",
  plateau: "implementation",
  gap: "implementation",
};

export function isArchimateStyle(style: string): boolean {
  return /mxgraph\.archimate3/i.test(style);
}

/** Infer ArchiMate layer from cell style (fill / appType / shape). */
export function archimateLayerFromStyle(style: string): ArchimateLayer | null {
  if (!isArchimateStyle(style) && !/archimate/i.test(style)) {
    // Still allow fill-based guess for recolored archimate cells
    const fillMatch = /fillColor=(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})/i.exec(style);
    if (!fillMatch) return null;
  }

  const fillMatch = /fillColor=(#[0-9a-fA-F]{6}|none)/i.exec(style);
  const fill = fillMatch?.[1]?.toLowerCase();
  if (fill && FILL_TO_LAYER[fill]) return FILL_TO_LAYER[fill];

  const appType = /appType=([a-zA-Z0-9]+)/i.exec(style)?.[1]?.toLowerCase();
  if (appType) {
    // Stakeholder is role+oct on motivation fill — fill already handled.
    if (APP_TYPE_TO_LAYER[appType]) return APP_TYPE_TO_LAYER[appType];
    // Shared behavior types: use archiType / context
    if (
      appType === "proc" ||
      appType === "func" ||
      appType === "serv" ||
      appType === "event" ||
      appType === "interaction" ||
      appType === "collab" ||
      appType === "interface"
    ) {
      // Without fill, unknown layer
      return "other";
    }
  }

  if (isArchimateStyle(style)) return "other";
  return null;
}

export function archimateLayerIndex(layer: ArchimateLayer): number {
  const i = ARCHIMATE_LAYER_ORDER.indexOf(layer);
  return i >= 0 ? i : ARCHIMATE_LAYER_ORDER.length - 1;
}
