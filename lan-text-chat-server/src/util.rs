use chrono::Utc;

pub fn truncate_preview(text: &str) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.len() > 120 {
        format!("{}...", &normalized[..117])
    } else {
        normalized
    }
}

pub fn uuid_like() -> String {
    let now = Utc::now();
    format!(
        "{}-{}",
        now.timestamp_millis(),
        now.timestamp_subsec_nanos()
    )
}

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
