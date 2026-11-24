# 本机模型与第三方组件

本仓库仅提供接入代码与下载脚本，不分发模型权重或捆绑模型运行时。

| 组件 | 用途 | 上游声明许可证 | 发布方式 |
| --- | --- | --- | --- |
| Qwen3-VL-4B-Instruct / Ollama qwen3-vl:4b | 本机识物与问答 | Apache-2.0，以实际下载版本的 LICENSE/NOTICE 为准 | 用户从上游下载，仓库不含权重 |
| Ollama | 本机模型运行时 | MIT，第三方部分另有许可 | 安装脚本下载官方 Windows 发行包 |
| React | 前端界面 | MIT | 依赖清单安装，已有许可见 docs/licenses/react-MIT.txt |

来源标识：Hugging Face `Qwen/Qwen3-VL-4B-Instruct`、Ollama Library `qwen3-vl:4b`、GitHub `ollama/ollama`。
下载脚本默认将运行时和模型放在项目外的本机工具目录，将设置写入当前用户本机配置目录。
后端与前端的其他依赖分别由 requirements 和 package-lock 文件登记，应保留各自许可证。
FFmpeg 的分发条件取决于实际构建，不能仅按软件名称判断；本次不分发 FFmpeg 二进制。
本说明不是对所有依赖的完整法律审计，也不替团队源码选择整体开源许可证。
