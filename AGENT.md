# 3GPP Decode Encoder - AGENTS.md

> 本文件是项目导航入口（给 AI Agent 和开发者看的目录页）。
> 遵循 Harness Engineering "地图而非手册" 原则：~50 行入口，指向更深层文档。

## 项目定位

web应用程序，支持下面三个功能：
1）对3GPP规范的5G RRC的ASN.1消息进行解码和编码
2）对3GPP规范的 5G NAS的TLV消息进行解码和编码
3）对NAS消息进行明文和秘文之间的相互转化
同时作为 TDD + SDD + Harness Engineering 的学习案例。

## 关键文件导航
| 文件 | 用途 |
|------|------|
| `spec/WEB_API_CONTRACT.md`   |  web API contract for the 3GPP decoder/encoder system |
| `README.md`                  |  项目结构介绍，前后端setup说明，当前支持的功能介绍，当前的实现限制等 |


## 开发约定
1. **Spec 同步**：修改代码时必须同步更新 `spec/WEB_API_CONTRACT.md`和`README.md` 
2. 代码注释使用英文注释


## 测试命令



## 架构约束

