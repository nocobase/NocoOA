import type { ImportKind } from './constants.js';

/**
 * How a cell is read. `code` is a letters/digits code, `user` an existing account named by username or email,
 * `boolean` 是/否, `status` an employee status, `date` an Excel date or `YYYY-MM-DD`.
 */
export type ColumnType =
  'code' | 'text' | 'integer' | 'boolean' | 'date' | 'user' | 'status';

export interface ColumnSpec {
  /** Stable key; the client translates errors about it and the report names it. */
  readonly key: string;
  /** Canonical Chinese header; English workbook headers are supplied by the workbook locale. */
  readonly header: string;
  readonly type: ColumnType;
  readonly required: boolean;
  /** Longest accepted text. */
  readonly max?: number;
  /** Explanation written on the template's instructions sheet. */
  readonly note: string;
}

export interface KindSpec {
  readonly kind: ImportKind;
  /** Name of the data sheet in the template; any first sheet is read. */
  readonly sheet: string;
  readonly title: string;
  readonly columns: readonly ColumnSpec[];
  /** What a row is matched on. */
  readonly matchedBy: string;
  /** Rows of example data the template carries, as cell text in column order. */
  readonly example: readonly (readonly string[])[];
}

const USER_NOTE =
  '已存在的登录账号，填用户名或邮箱。导入不会创建账号：账号不存在或已停用时该行报错，请先在“用户”页面创建或启用。';
const ACTIVE_NOTE = '是 / 否，留空视为“是”。';

const departments: KindSpec = {
  kind: 'departments',
  sheet: '部门',
  title: '部门树',
  matchedBy: '部门编码',
  columns: [
    {
      key: 'code',
      header: '部门编码',
      type: 'code',
      required: true,
      max: 64,
      note: '必填。字母、数字、“.”“_”“-”，最长 64 位。已存在的编码更新该部门，否则新建。',
    },
    {
      key: 'title',
      header: '部门名称',
      type: 'text',
      required: true,
      max: 255,
      note: '必填。',
    },
    {
      key: 'parentCode',
      header: '上级部门编码',
      type: 'code',
      required: false,
      max: 64,
      note: '留空为一级部门。可以引用本表中后面的行或系统中已有的部门；不能形成循环。',
    },
    {
      key: 'manager',
      header: '部门负责人',
      type: 'user',
      required: false,
      note: `${USER_NOTE} 留空表示无负责人。`,
    },
    {
      key: 'executive',
      header: '分管领导',
      type: 'user',
      required: false,
      note: `${USER_NOTE} 一般只填一级部门，下级部门沿上级查找。`,
    },
    {
      key: 'sortOrder',
      header: '排序',
      type: 'integer',
      required: false,
      note: '整数，越小越靠前；留空为 0。',
    },
    {
      key: 'active',
      header: '是否启用',
      type: 'boolean',
      required: false,
      note: ACTIVE_NOTE,
    },
  ],
  example: [
    ['HQ', '总公司', '', 'admin@example.com', '', '0', '是'],
    ['RD', '研发中心', 'HQ', '', 'cto@example.com', '10', '是'],
  ],
};

const positions: KindSpec = {
  kind: 'positions',
  sheet: '岗位',
  title: '岗位',
  matchedBy: '岗位编码',
  columns: [
    {
      key: 'code',
      header: '岗位编码',
      type: 'code',
      required: true,
      max: 64,
      note: '必填。已存在的编码更新该岗位，否则新建。',
    },
    {
      key: 'title',
      header: '岗位名称',
      type: 'text',
      required: true,
      max: 255,
      note: '必填。',
    },
    {
      key: 'sortOrder',
      header: '排序',
      type: 'integer',
      required: false,
      note: '整数，越小越靠前；留空为 0。',
    },
    {
      key: 'active',
      header: '是否启用',
      type: 'boolean',
      required: false,
      note: ACTIVE_NOTE,
    },
  ],
  example: [
    ['BUYER', '采购专员', '10', '是'],
    ['ACCT', '会计', '20', '是'],
  ],
};

const grades: KindSpec = {
  kind: 'grades',
  sheet: '职级',
  title: '职级',
  matchedBy: '职级编码',
  columns: [
    {
      key: 'code',
      header: '职级编码',
      type: 'code',
      required: true,
      max: 64,
      note: '必填，如 P5、M2。已存在的编码更新该职级，否则新建。',
    },
    {
      key: 'title',
      header: '职级名称',
      type: 'text',
      required: true,
      max: 255,
      note: '必填。',
    },
    {
      key: 'rank',
      header: '级别',
      type: 'integer',
      required: true,
      note: '必填整数，越大越高；用于经理级、总监级分档。',
    },
    {
      key: 'active',
      header: '是否启用',
      type: 'boolean',
      required: false,
      note: ACTIVE_NOTE,
    },
  ],
  example: [
    ['P5', '高级工程师', '50', '是'],
    ['M2', '经理', '80', '是'],
  ],
};

const employees: KindSpec = {
  kind: 'employees',
  sheet: '员工档案',
  title: '员工档案',
  matchedBy: '工号',
  columns: [
    {
      key: 'code',
      header: '工号',
      type: 'code',
      required: true,
      max: 64,
      note: '必填。已存在的工号更新该档案，否则新建。',
    },
    {
      key: 'name',
      header: '姓名',
      type: 'text',
      required: true,
      max: 255,
      note: '必填。',
    },
    {
      key: 'user',
      header: '登录账号',
      type: 'user',
      required: true,
      note: `必填。${USER_NOTE} 一个账号只能绑定一份档案。`,
    },
    {
      key: 'departmentCode',
      header: '主部门编码',
      type: 'code',
      required: false,
      max: 64,
      note: '已有部门的编码（先导入部门）。填写后该部门成为此人的主部门，原主部门的成员关系随之移除；留空不改动部门成员关系。',
    },
    {
      key: 'managerCode',
      header: '直属上级工号',
      type: 'code',
      required: false,
      max: 64,
      note: '上级的工号，可以引用本表中的其他行；不能是本人，不能形成循环，上级不能已离职。留空表示无直属上级。',
    },
    {
      key: 'positionCode',
      header: '岗位编码',
      type: 'code',
      required: false,
      max: 64,
      note: '已启用岗位的编码；留空表示无岗位。',
    },
    {
      key: 'gradeCode',
      header: '职级编码',
      type: 'code',
      required: false,
      max: 64,
      note: '已启用职级的编码；留空表示无职级。',
    },
    {
      key: 'careerStartDate',
      header: '首次参加工作日期',
      type: 'date',
      required: false,
      note: '可选：累计工龄的起始日期，如 2010-07-01；不能晚于入职日期或今天。未知留空，不以入职日期推算。',
    },
    {
      key: 'hireDate',
      header: '入职日期',
      type: 'date',
      required: false,
      note: '日期，如 2026-10-01。',
    },
    {
      key: 'probationEndDate',
      header: '试用期结束日期',
      type: 'date',
      required: false,
      note: '日期，如 2027-01-01。',
    },
    {
      key: 'status',
      header: '状态',
      type: 'status',
      required: true,
      note: '必填：试用 / 正式 / 离职中 / 已离职。更新已有档案时改变状态记为一次管理员数据修正，写入员工变动记录。',
    },
    {
      key: 'phone',
      header: '手机',
      type: 'text',
      required: false,
      max: 64,
      note: '',
    },
    {
      key: 'email',
      header: '邮箱',
      type: 'text',
      required: false,
      max: 255,
      note: '工作邮箱，可与登录账号不同。',
    },
    {
      key: 'workLocation',
      header: '工作地点',
      type: 'text',
      required: false,
      max: 255,
      note: '',
    },
    {
      key: 'emergencyContact',
      header: '紧急联系人',
      type: 'text',
      required: false,
      max: 255,
      note: '',
    },
  ],
  example: [
    [
      'E0001',
      '张三',
      'zhangsan@example.com',
      'HQ',
      '',
      '',
      'M2',
      '2020-03-01',
      '',
      '正式',
      '13800000000',
      'zhangsan@example.com',
      '上海',
      '',
    ],
    [
      'E0002',
      '李四',
      'lisi',
      'RD',
      'E0001',
      'BUYER',
      'P5',
      '2026-10-08',
      '2027-01-07',
      '试用',
      '',
      '',
      '上海',
      '',
    ],
  ],
};

const dutyRoleMembers: KindSpec = {
  kind: 'dutyRoleMembers',
  sheet: '角色池成员',
  title: '职能角色池成员',
  matchedBy: '角色编码 + 成员账号',
  columns: [
    {
      key: 'roleCode',
      header: '角色编码',
      type: 'code',
      required: true,
      max: 64,
      note: '必填，系统中已有的角色编码，如 gm、finance、cashier、hr。',
    },
    {
      key: 'user',
      header: '成员账号',
      type: 'user',
      required: true,
      note: `必填。${USER_NOTE}`,
    },
    {
      key: 'active',
      header: '是否启用',
      type: 'boolean',
      required: false,
      note: '是：加入该角色池（已在其中则不变）；否：从角色池移除。留空视为“是”。',
    },
  ],
  example: [
    ['finance', 'zhangsan@example.com', '是'],
    ['cashier', 'lisi', '是'],
  ],
};

export const KIND_SPECS: Readonly<Record<ImportKind, KindSpec>> = {
  departments,
  positions,
  grades,
  employees,
  dutyRoleMembers,
};
