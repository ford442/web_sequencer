$models = @(
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/onnx/duration_predictor.onnx"; out="public/assets/onnx/duration_predictor.onnx"},
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/onnx/text_encoder.onnx"; out="public/assets/onnx/text_encoder.onnx"},
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/onnx/vector_estimator.onnx"; out="public/assets/onnx/vector_estimator.onnx"},
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/onnx/vocoder.onnx"; out="public/assets/onnx/vocoder.onnx"},
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/onnx/tts.json"; out="public/assets/onnx/tts.json"},
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/onnx/unicode_indexer.json"; out="public/assets/onnx/unicode_indexer.json"},
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/voice_styles/M1.json"; out="public/assets/onnx/voice_styles/M1.json"},
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/voice_styles/M2.json"; out="public/assets/onnx/voice_styles/M2.json"},
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/voice_styles/F1.json"; out="public/assets/onnx/voice_styles/F1.json"},
    @{url="https://huggingface.co/Supertone/supertonic/resolve/main/voice_styles/F2.json"; out="public/assets/onnx/voice_styles/F2.json"}
)

Write-Host "Downloading Supertonic TTS models from HuggingFace..." -ForegroundColor Cyan

foreach ($model in $models) {
    $filename = Split-Path $model.out -Leaf
    Write-Host "Downloading $filename..." -ForegroundColor Yellow
    try {
        Invoke-WebRequest -Uri $model.url -OutFile $model.out -UseBasicParsing
        $size = (Get-Item $model.out).length / 1MB
        $sizeStr = "{0:F2} MB" -f $size
        Write-Host "  Downloaded $sizeStr" -ForegroundColor Green
    } catch {
        Write-Host "  Failed: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Download complete!" -ForegroundColor Green
Write-Host "Models saved to public/assets/onnx/" -ForegroundColor Cyan
