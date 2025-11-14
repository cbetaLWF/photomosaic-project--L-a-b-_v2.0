// 線画抽出（Sobel）のためのヘルパー関数
function applySobelFilter(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    
    // 1. グレースケールに変換
    const grayscaleData = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        // 知覚輝度 (Luma)
        const gray = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        grayscaleData[i / 4] = gray;
    }

    // 最終描画用の線画データ (透明で初期化)
    const finalSobelData = new Uint8ClampedArray(data.length);
    
    const Gx = [
        [-1, 0, 1],
        [-2, 0, 2],
        [-1, 0, 1]
    ];
    const Gy = [
        [-1, -2, -1],
        [0, 0, 0],
        [1, 2, 1]
    ];
    
    // 3段階の閾値
    const thresholds = {
        low: 15, // 弱いディテール（質感）
        med: 30, // 最終描画用の線画
        high: 80 // 強い輪郭（アニメ線など）
    };
    
    // 3段階のディテール量を格納するベクトル
    const detailVector = { low: 0, med: 0, high: 0 };

    // 2. Sobelフィルタ適用 (1回のループで全て計算)
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sumX = 0;
            let sumY = 0;

            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx));
                    if (idx < 0 || idx >= grayscaleData.length) continue; // 境界チェック
                    const gray = grayscaleData[idx];
                    sumX += gray * Gx[ky + 1][kx + 1];
                    sumY += gray * Gy[ky + 1][kx + 1];
                }
            }

            const magnitude = Math.sqrt(sumX * sumX + sumY * sumY);
            const i = (y * width + x) * 4;

            // 1. 最終描画用の線画データ (med threshold)
            if (magnitude > thresholds.med) {
                const alpha = Math.min(255, magnitude * 1.5);
                finalSobelData[i] = 0;    // R (黒)
                finalSobelData[i + 1] = 0; // G (黒)
                finalSobelData[i + 2] = 0; // B (黒)
                finalSobelData[i + 3] = alpha; // A (不透明度)
                
                detailVector.med += alpha; // 中ディテール量
            }
            
            // 2. 賢い評価用の特徴ベクトル
            if (magnitude > thresholds.low) {
                detailVector.low += magnitude; 
            }
            if (magnitude > thresholds.high) {
                detailVector.high += magnitude;
            }
        }
    }
    
    return { 
        finalEdgeImageData: new ImageData(finalSobelData, width, height), 
        detailVector: detailVector
    };
}

// 画像を分析し、推奨値を返すヘルパー関数
function analyzeImageAndGetRecommendations(image, analysisImageData) {
    const width = image.width;
    const height = image.height;
    const data = analysisImageData.data; 
    
    let sumLuma = 0;
    for (let i = 0; i < data.length; i += 4) {
        const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        sumLuma += luma;
    }
    const pixelCount = data.length / 4;
    const meanLuma = sumLuma / pixelCount; 
    
    const edgeResult = applySobelFilter(analysisImageData); 
    const detailVector = edgeResult.detailVector; 
    
    const detailLow = (detailVector.low / pixelCount) || 0;    
    const detailHigh = (detailVector.high / pixelCount) || 0; 
    
    const recommendations = {};
    if (width > 3000) recommendations.tileSize = 15;
    else if (width > 1500) recommendations.tileSize = 25;
    else recommendations.tileSize = 30;
    recommendations.brightnessCompensation = 100;
    recommendations.textureWeight = Math.round(Math.min(200, detailLow * 3.0 + 30)); 
    recommendations.blendRange = Math.round(Math.max(10, meanLuma / 7.0)); 
    recommendations.edgeOpacity = Math.round(Math.max(10, 60 - detailHigh * 10.0));
    
    return recommendations;
}
// ヘルパー関数ここまで


document.addEventListener('DOMContentLoaded', async () => {
    // --- UI要素の取得 ---
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button
