//! Semantic 3-way merge for `.markspace/order.json`.
//!
//! Concurrent reorders on different machines would otherwise always conflict
//! under plain git text merge. We merge per-folder sibling lists instead.

use std::collections::{HashMap, HashSet};

pub type OrderMap = HashMap<String, Vec<String>>;

pub const ORDER_REL: &str = ".markspace/order.json";

pub fn parse_order(raw: &str) -> OrderMap {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return OrderMap::new();
    };
    let Some(obj) = value.as_object() else {
        return OrderMap::new();
    };
    let mut map = OrderMap::new();
    for (k, v) in obj {
        if let Some(arr) = v.as_array() {
            let names: Vec<String> = arr
                .iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect();
            if !names.is_empty() {
                map.insert(k.clone(), names);
            }
        }
    }
    map
}

pub fn serialize_order(order: &OrderMap) -> String {
    let mut sorted_keys: Vec<&String> = order.keys().collect();
    sorted_keys.sort();
    let mut obj = serde_json::Map::new();
    for key in sorted_keys {
        if let Some(names) = order.get(key) {
            if names.is_empty() {
                continue;
            }
            obj.insert(
                key.clone(),
                serde_json::Value::Array(
                    names
                        .iter()
                        .map(|n| serde_json::Value::String(n.clone()))
                        .collect(),
                ),
            );
        }
    }
    let pretty = serde_json::to_string_pretty(&serde_json::Value::Object(obj))
        .unwrap_or_else(|_| "{}".into());
    format!("{pretty}\n")
}

pub fn merge_order_maps(base: &OrderMap, ours: &OrderMap, theirs: &OrderMap) -> OrderMap {
    let mut keys: HashSet<String> = HashSet::new();
    keys.extend(base.keys().cloned());
    keys.extend(ours.keys().cloned());
    keys.extend(theirs.keys().cloned());

    let empty: Vec<String> = Vec::new();
    let mut out = OrderMap::new();
    for key in keys {
        let b = base.get(&key).unwrap_or(&empty);
        let o = ours.get(&key).unwrap_or(&empty);
        let t = theirs.get(&key).unwrap_or(&empty);
        let merged = merge_sibling_lists(b, o, t);
        if !merged.is_empty() {
            out.insert(key, merged);
        }
    }
    out
}

/// 3-way merge of a sibling name list.
///
/// - Unchanged side → take the other
/// - Same result → that result
/// - Otherwise: union of names, ordered by topological merge of both
///   "before" constraints (ours preferred when breaking ties / cycles)
pub fn merge_sibling_lists(base: &[String], ours: &[String], theirs: &[String]) -> Vec<String> {
    if ours == base {
        return theirs.to_vec();
    }
    if theirs == base {
        return ours.to_vec();
    }
    if ours == theirs {
        return ours.to_vec();
    }

    let mut present: Vec<String> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for name in ours.iter().chain(theirs.iter()) {
        if seen.insert(name.as_str()) {
            present.push(name.clone());
        }
    }
    if present.is_empty() {
        return present;
    }

    let present_set: HashSet<&str> = present.iter().map(|s| s.as_str()).collect();

    let mut successors: HashMap<String, Vec<String>> = HashMap::new();
    let mut indegree: HashMap<String, usize> = HashMap::new();
    for name in &present {
        successors.entry(name.clone()).or_default();
        indegree.entry(name.clone()).or_insert(0);
    }

    add_before_edges(ours, &present_set, &mut successors, &mut indegree);
    add_before_edges(theirs, &present_set, &mut successors, &mut indegree);

    let ours_rank: HashMap<&str, usize> = ours
        .iter()
        .enumerate()
        .map(|(i, s)| (s.as_str(), i))
        .collect();
    let theirs_rank: HashMap<&str, usize> = theirs
        .iter()
        .enumerate()
        .map(|(i, s)| (s.as_str(), i))
        .collect();

    let mut result: Vec<String> = Vec::with_capacity(present.len());
    let mut ready: Vec<String> = indegree
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(k, _)| k.clone())
        .collect();

    while !ready.is_empty() {
        ready.sort_by(|a, b| {
            let ra = ours_rank.get(a.as_str()).copied().unwrap_or(usize::MAX);
            let rb = ours_rank.get(b.as_str()).copied().unwrap_or(usize::MAX);
            ra.cmp(&rb).then_with(|| {
                let ta = theirs_rank.get(a.as_str()).copied().unwrap_or(usize::MAX);
                let tb = theirs_rank.get(b.as_str()).copied().unwrap_or(usize::MAX);
                ta.cmp(&tb).then_with(|| a.cmp(b))
            })
        });
        let node = ready.remove(0);
        result.push(node.clone());
        let nexts = successors.get(&node).cloned().unwrap_or_default();
        for succ in nexts {
            if let Some(d) = indegree.get_mut(&succ) {
                *d = d.saturating_sub(1);
                if *d == 0 {
                    ready.push(succ);
                }
            }
        }
    }

    if result.len() < present.len() {
        let in_result: HashSet<String> = result.iter().cloned().collect();
        for name in &present {
            if !in_result.contains(name) {
                result.push(name.clone());
            }
        }
    }

    result
}

fn add_before_edges(
    list: &[String],
    present: &HashSet<&str>,
    successors: &mut HashMap<String, Vec<String>>,
    indegree: &mut HashMap<String, usize>,
) {
    let filtered: Vec<&String> = list
        .iter()
        .filter(|n| present.contains(n.as_str()))
        .collect();
    for window in filtered.windows(2) {
        let a = window[0];
        let b = window[1];
        let succ = successors.entry(a.clone()).or_default();
        if !succ.iter().any(|x| x == b) {
            succ.push(b.clone());
            *indegree.entry(b.clone()).or_insert(0) += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| (*n).to_string()).collect()
    }

    #[test]
    fn unchanged_side_takes_other() {
        let base = s(&["a", "b", "c"]);
        let ours = s(&["a", "c", "b"]);
        let theirs = base.clone();
        assert_eq!(merge_sibling_lists(&base, &ours, &theirs), ours);

        let ours2 = base.clone();
        let theirs2 = s(&["c", "a", "b"]);
        assert_eq!(merge_sibling_lists(&base, &ours2, &theirs2), theirs2);
    }

    #[test]
    fn identical_sides() {
        let base = s(&["a", "b"]);
        let both = s(&["b", "a"]);
        assert_eq!(merge_sibling_lists(&base, &both, &both), both);
    }

    #[test]
    fn different_folders_independent() {
        let mut base = OrderMap::new();
        base.insert("".into(), s(&["a.md", "b.md"]));
        base.insert("proj".into(), s(&["x.md", "y.md"]));

        let mut ours = base.clone();
        ours.insert("".into(), s(&["b.md", "a.md"]));

        let mut theirs = base.clone();
        theirs.insert("proj".into(), s(&["y.md", "x.md"]));

        let merged = merge_order_maps(&base, &ours, &theirs);
        assert_eq!(merged.get("").unwrap(), &s(&["b.md", "a.md"]));
        assert_eq!(merged.get("proj").unwrap(), &s(&["y.md", "x.md"]));
    }

    #[test]
    fn insert_on_one_side() {
        let base = s(&["a", "c"]);
        let ours = s(&["a", "b", "c"]);
        let theirs = s(&["a", "c"]);
        assert_eq!(merge_sibling_lists(&base, &ours, &theirs), s(&["a", "b", "c"]));
    }

    #[test]
    fn delete_on_one_side_keeps_from_other() {
        // ours removed b, theirs kept base — take ours (theirs == base)
        let base = s(&["a", "b", "c"]);
        let ours = s(&["a", "c"]);
        let theirs = base.clone();
        assert_eq!(merge_sibling_lists(&base, &ours, &theirs), s(&["a", "c"]));
    }

    #[test]
    fn delete_on_both_sides() {
        let base = s(&["a", "b", "c"]);
        let ours = s(&["a", "c"]);
        let theirs = s(&["a", "c"]);
        assert_eq!(merge_sibling_lists(&base, &ours, &theirs), s(&["a", "c"]));
    }

    #[test]
    fn concurrent_inserts() {
        let base = s(&["a", "d"]);
        let ours = s(&["a", "b", "d"]);
        let theirs = s(&["a", "c", "d"]);
        let merged = merge_sibling_lists(&base, &ours, &theirs);
        assert_eq!(merged.first().map(String::as_str), Some("a"));
        assert_eq!(merged.last().map(String::as_str), Some("d"));
        assert!(merged.contains(&"b".into()));
        assert!(merged.contains(&"c".into()));
        assert_eq!(merged.len(), 4);
    }

    #[test]
    fn serialize_roundtrip_sorted_keys() {
        let mut map = OrderMap::new();
        map.insert("z".into(), s(&["1.md"]));
        map.insert("".into(), s(&["a.md", "b.md"]));
        let raw = serialize_order(&map);
        let parsed = parse_order(&raw);
        assert_eq!(parsed.get("").unwrap(), &s(&["a.md", "b.md"]));
        assert_eq!(parsed.get("z").unwrap(), &s(&["1.md"]));
        assert!(raw.find("\"\"").unwrap() < raw.find("\"z\"").unwrap());
    }

    #[test]
    fn parse_invalid_returns_empty() {
        assert!(parse_order("not json").is_empty());
        assert!(parse_order("[]").is_empty());
    }
}
