package com.markspace.tasknotes

import org.yaml.snakeyaml.LoaderOptions
import org.yaml.snakeyaml.Yaml
import org.yaml.snakeyaml.constructor.SafeConstructor

data class SplitFrontmatter(
    val data: MutableMap<String, Any?>?,
    val body: String,
    val hasFence: Boolean,
    val rawYaml: String?,
)

private const val FENCE = "---"

private fun stripBom(text: String): String =
    if (text.isNotEmpty() && text[0] == '\uFEFF') text.substring(1) else text

fun splitFrontmatter(markdown: String): SplitFrontmatter {
    val text = stripBom(markdown)
    if (!text.startsWith("$FENCE\n") && !text.startsWith("$FENCE\r\n")) {
        return SplitFrontmatter(null, text, hasFence = false, rawYaml = null)
    }
    val afterOpen = if (text.startsWith("$FENCE\r\n")) 5 else 4
    val rest = text.substring(afterOpen)
    val closeMatch = Regex("\\r?\\n---[ \\t]*(?:\\r?\\n|$)").find(rest)
        ?: return SplitFrontmatter(null, text, hasFence = false, rawYaml = null)

    val yamlText = rest.substring(0, closeMatch.range.first)
    val body = rest.substring(closeMatch.range.last + 1)

    return try {
        val yaml = Yaml(SafeConstructor(LoaderOptions()))
        val parsed = yaml.load<Any?>(yamlText)
        when {
            parsed == null -> SplitFrontmatter(mutableMapOf(), body, true, yamlText)
            parsed is Map<*, *> -> {
                val map = mutableMapOf<String, Any?>()
                for ((k, v) in parsed) {
                    if (k != null) map[k.toString()] = v
                }
                SplitFrontmatter(map, body, true, yamlText)
            }
            else -> SplitFrontmatter(mutableMapOf(), body, true, yamlText)
        }
    } catch (_: Exception) {
        SplitFrontmatter(null, body, hasFence = true, rawYaml = yamlText)
    }
}

fun normalizeTags(value: Any?): List<String> {
    val out = mutableListOf<String>()
    val seen = mutableSetOf<String>()

    fun push(raw: Any?) {
        when (raw) {
            is Map<*, *> -> {
                push(raw["name"] ?: raw["tag"] ?: raw["title"])
            }
            is String, is Number -> {
                val name = raw.toString().trim().trimStart('#').trim()
                if (name.isEmpty()) return
                val key = name.lowercase()
                if (seen.add(key)) out.add(name)
            }
        }
    }

    when (value) {
        null -> Unit
        is List<*> -> value.forEach { push(it) }
        is String -> {
            if (value.contains(",")) value.split(",").forEach { push(it) }
            else push(value)
        }
        else -> push(value)
    }
    return out
}

fun formatFrontmatterYaml(data: Map<String, Any?>): String {
    if (data.isEmpty()) return ""
    // Hand-write YAML for stable task attrs (avoid SnakeYAML date/tag quirks).
    val preferred = listOf("id", "status", "due", "priority", "labels", "created", "parent")
    val keys = linkedSetOf<String>()
    preferred.filter { data.containsKey(it) }.forEach { keys.add(it) }
    data.keys.filter { it !in keys }.forEach { keys.add(it) }

    val sb = StringBuilder("---\n")
    for (k in keys) {
        val v = data[k] ?: continue
        sb.append(k).append(": ").append(formatYamlScalar(v)).append('\n')
    }
    sb.append("---\n")
    return sb.toString()
}

private fun formatYamlScalar(value: Any): String =
    when (value) {
        is String -> value
        is Number, is Boolean -> value.toString()
        is List<*> -> value.joinToString(prefix = "[", postfix = "]") { item ->
            when (item) {
                null -> "null"
                is String -> item
                else -> item.toString()
            }
        }
        is java.util.Date -> {
            val cal = java.util.Calendar.getInstance().apply { time = value }
            "%04d-%02d-%02d".format(
                cal.get(java.util.Calendar.YEAR),
                cal.get(java.util.Calendar.MONTH) + 1,
                cal.get(java.util.Calendar.DAY_OF_MONTH),
            )
        }
        else -> value.toString()
    }

fun mergeFrontmatter(data: Map<String, Any?>?, body: String): String {
    if (data.isNullOrEmpty()) return body
    return formatFrontmatterYaml(data) + body
}
