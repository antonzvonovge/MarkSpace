use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config, DTYPE};
use std::path::Path;
use tokenizers::{PaddingParams, TruncationParams, Tokenizer};

/// Multilingual MiniLM sentence-transformers default max length.
const MAX_SEQ_LEN: usize = 128;

pub struct Embedder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl Embedder {
    pub fn load(model_dir: &Path) -> Result<Self, String> {
        let device = Device::Cpu;
        let config_path = model_dir.join("config.json");
        let tokenizer_path = model_dir.join("tokenizer.json");
        let weights_path = model_dir.join("model.safetensors");

        for p in [&config_path, &tokenizer_path, &weights_path] {
            if !p.is_file() {
                return Err(format!("Embedding model file missing: {}", p.display()));
            }
        }

        let config_str = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Cannot read embedding config: {e}"))?;
        let config: Config = serde_json::from_str(&config_str)
            .map_err(|e| format!("Cannot parse embedding config: {e}"))?;

        let mut tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Cannot load tokenizer: {e}"))?;

        let trunc = TruncationParams {
            max_length: MAX_SEQ_LEN,
            ..Default::default()
        };
        tokenizer
            .with_truncation(Some(trunc))
            .map_err(|e| format!("Tokenizer truncation: {e}"))?;

        let padding = PaddingParams {
            strategy: tokenizers::PaddingStrategy::BatchLongest,
            ..Default::default()
        };
        tokenizer.with_padding(Some(padding));

        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[weights_path], DTYPE, &device)
                .map_err(|e| format!("Cannot load embedding weights: {e}"))?
        };
        let model =
            BertModel::load(vb, &config).map_err(|e| format!("Cannot load BertModel: {e}"))?;

        Ok(Self {
            model,
            tokenizer,
            device,
        })
    }

    pub fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        let encodings = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|e| format!("Tokenize failed: {e}"))?;

        let mut token_ids = Vec::with_capacity(encodings.len());
        let mut attention_masks = Vec::with_capacity(encodings.len());
        for enc in &encodings {
            token_ids.push(
                Tensor::new(enc.get_ids(), &self.device)
                    .map_err(|e| format!("token_ids tensor: {e}"))?,
            );
            attention_masks.push(
                Tensor::new(enc.get_attention_mask(), &self.device)
                    .map_err(|e| format!("attention_mask tensor: {e}"))?,
            );
        }

        let token_ids = Tensor::stack(&token_ids, 0).map_err(|e| format!("stack ids: {e}"))?;
        let attention_mask =
            Tensor::stack(&attention_masks, 0).map_err(|e| format!("stack mask: {e}"))?;
        let token_type_ids = token_ids
            .zeros_like()
            .map_err(|e| format!("token_type_ids: {e}"))?;

        let embeddings = self
            .model
            .forward(&token_ids, &token_type_ids, Some(&attention_mask))
            .map_err(|e| format!("Bert forward: {e}"))?;

        // Mean pool with attention mask, then L2 normalize (sentence-transformers).
        let mask = attention_mask
            .to_dtype(DTYPE)
            .map_err(|e| format!("mask dtype: {e}"))?
            .unsqueeze(2)
            .map_err(|e| format!("mask unsqueeze: {e}"))?;
        let sum_mask = mask.sum(1).map_err(|e| format!("sum_mask: {e}"))?;
        let summed = embeddings
            .broadcast_mul(&mask)
            .map_err(|e| format!("mask mul: {e}"))?
            .sum(1)
            .map_err(|e| format!("sum: {e}"))?;
        let pooled = summed
            .broadcast_div(&sum_mask)
            .map_err(|e| format!("div: {e}"))?;
        let normalized = normalize_l2(&pooled)?;

        let n = texts.len();
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let row = normalized
                .get(i)
                .map_err(|e| format!("get row: {e}"))?
                .to_vec1::<f32>()
                .map_err(|e| format!("to_vec: {e}"))?;
            out.push(row);
        }
        Ok(out)
    }

    pub fn embed_one(&self, text: &str) -> Result<Vec<f32>, String> {
        let mut rows = self.embed(&[text.to_string()])?;
        rows.pop().ok_or_else(|| "Empty embedding".into())
    }
}

fn normalize_l2(v: &Tensor) -> Result<Tensor, String> {
    let norm = v
        .sqr()
        .map_err(|e| format!("sqr: {e}"))?
        .sum_keepdim(1)
        .map_err(|e| format!("sum_keepdim: {e}"))?
        .sqrt()
        .map_err(|e| format!("sqrt: {e}"))?;
    v.broadcast_div(&norm).map_err(|e| format!("l2 div: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embeddings::types::{EMBEDDING_DIM, MODEL_ID};
    use std::path::PathBuf;
    use std::time::Instant;

    /// Run explicitly: `cargo test --lib model_load_timing -- --ignored --nocapture`
    #[test]
    #[ignore = "requires the downloaded model in app data"]
    fn model_load_timing() {
        let dir = model_dir_for_test();
        if !dir.join("model.safetensors").is_file() {
            eprintln!("model not installed at {}", dir.display());
            return;
        }
        let started = Instant::now();
        let embedder = Embedder::load(&dir).expect("load embedder");
        println!("model load: {:?}", started.elapsed());

        let started = Instant::now();
        let en = embedder.embed_one("employee onboarding checklist").unwrap();
        println!("query embed: {:?}", started.elapsed());

        let ru = embedder.embed_one("чеклист онбординга сотрудников").unwrap();
        assert_eq!(en.len(), EMBEDDING_DIM);
        let sim: f32 = en.iter().zip(&ru).map(|(a, b)| a * b).sum();
        println!("ru/en similarity: {sim:.3}");
        assert!(sim > 0.35, "cross-lingual similarity too low: {sim}");
    }

    fn model_dir_for_test() -> PathBuf {
        if let Ok(dir) = std::env::var("MARKSPACE_MODEL_DIR") {
            return PathBuf::from(dir);
        }
        PathBuf::from(std::env::var("HOME").expect("HOME"))
            .join(".local/share/com.atott.markspace/models")
            .join(MODEL_ID)
    }
}

