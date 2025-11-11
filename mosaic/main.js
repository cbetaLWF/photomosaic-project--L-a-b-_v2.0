document.addEventListener('DOMContentLoaded', async () => {
    // UI要素の取得
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    
    // ★ 変更点 (提案3): ヒストグラムスライダー -> テクスチャ比率スライダー
    const textureRatioInput = document.getElementById('texture-ratio');
    const textureRatioValue = document.getElementById('texture-ratio-value');

    // 全ての必須要素が存在するかチェック
    if (!mainCanvas || !statusText || !generateButton) {
        console.error("Initialization Error: One or more required HTML elements are missing.");
        document.body.innerHTML = "<h1>Initialization Error</h1><p>The application failed to load because required elements (Canvas, Buttons, Status) are missing from the HTML.</p>";
        return;
    }
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null;
    let mainImage = null;

    // --- UIの初期設定 ---
    generateButton.disabled = true;
    downloadButton.style.display = 'none';

    // 明度補正スライダーの値表示を更新
    if (brightnessCompensationInput && brightnessCompensationValue) {
        brightnessCompensationInput.addEventListener('input', () => {
            brightnessCompensationValue.textContent = brightnessCompensationInput.value;
        });
    }

    // ★ 変更点 (提案3): テクスチャ比率スライダーの値表示を更新
    if (textureRatioInput && textureRatioValue) {
        textureRatioInput.addEventListener('input', () => {
            textureRatioValue.textContent = textureRatioInput.value;
        });
    }

    // --- 1. タイルデータの初期ロード ---
    try {
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        if (!response.ok) {
            throw new Error(`tile_data.json のロードに失敗しました (HTTP ${response.status})。Analyzer Appでデータを作成し、/mosaic/フォルダに配置してください。`);
        }
        tileData = await response.json();
        
        // ★ 変更点: JSONが L*ベクトル(l_vector) を持っているかチェック
        if (tileData.length > 0 && !tileData[0].l_vector) {
             throw new Error('tile_data.jsonが古いようです。Analyzer AppでL*ベクトル情報を含む新しいデータを再生成してください。');
        }
        
        statusText.textContent = `ステータス: タイルデータ (${tileData.length}枚分) ロード完了。メイン画像を選択してください。`;
        if (mainImageInput) mainImageInput.disabled = false;
    } catch (error) {
        statusText.textContent = `エラー: ${error.message}`;
        console.error("Initialization Error:", error);
        return;
    }
    
    // --- 2. メイン画像アップロード --- (変更なし)
    if (mainImageInput) {
        mainImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                mainImage = new Image();
                mainImage.onload = () => {
                    generateButton.disabled = false;
                    downloadButton.style.display = 'none';
                    mainCanvas.width = mainImage.width;
                    mainCanvas.height = mainImage.height;
                    ctx.clearRect(0, 0, mainImage.width, mainImage.height);
                    ctx.drawImage(mainImage, 0, 0); 
                    statusText.textContent = `ステータス: 画像ロード完了 (${mainImage.width}x${mainImage.height})。生成ボタンを押してください。`;
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // --- 3. モザイク生成開始 ---
    generateButton.addEventListener('click', () => {
        if (!mainImage) return;
        
        generateButton.disabled = true;
        downloadButton.style.display = 'none';
        progressBar.style.width = '0%';
        statusText.textContent = 'ステータス: 画像データの準備中...';

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = mainImage.width;
        tempCanvas.height = mainImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(mainImage, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, mainImage.width, mainImage.height);

        const worker = new Worker('mosaic_worker.js');

        // Workerにデータを送信
        worker.postMessage({ 
            imageData: imageData, 
            tileData: tileData, 
            tileSize: parseInt(tileSizeInput.value),
            width: mainImage.width,
            height: mainImage.height,
            blendOpacity: parseInt(blendRangeInput.value),
            brightnessCompensation: parseInt(brightnessCompensationInput.value),
            // ★ 変更点 (提案3): 0-100の値を 0.0-1.0 の比率に変換して渡す
            textureRatio: parseFloat(textureRatioInput.value) / 100.0
        }, [imageData.data.buffer]); // バッファ転送で高速化

        // Workerからのメッセージ受信
        worker.onmessage = (e) => {
            if (e.data.type === 'status') {
                statusText.textContent = `ステータス: ${e.data.message}`;
            } else if (e.data.type === 'progress') {
                const progress = Math.round(e.data.progress * 100);
                progressBar.style.width = `${progress}%`;
            } else if (e.data.type === 'complete') {
                const { results, width, height, blendOpacity, brightnessCompensation } = e.data;
                renderMosaic(results, width, height, blendOpacity, brightnessCompensation);
                worker.terminate();
            }
        };

        worker.onerror = (error) => {
            statusText.textContent = `エラー: Worker処理中に問題が発生しました。 ${error.message}`;
            generateButton.disabled = false;
            worker.terminate();
            console.error("Worker Error:", error);
        };
    });

    // --- 4. 最終的なモザイクの描画 --- (変更なし)
    async function renderMosaic(results, width, height, blendOpacity, brightnessCompensation) {
        statusText.textContent = 'ステータス: タイル画像を読み込み、描画中...';
        mainCanvas.width = width;
        mainCanvas.height = height;
        ctx.clearRect(0, 0, width, height);

        let loadedCount = 0;
        const totalTiles = results.length;
        const promises = [];
        
        const MIN_TILE_L = 5.0; 
        const MAX_BRIGHTNESS_RATIO = 5.0; 
        const brightnessFactor = brightnessCompensation / 100; 

        for (const tile of results) {
            const p = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    let targetL = tile.targetL; 
                    let tileL = tile.tileL; 
                    if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
                    let brightnessRatio = targetL / tileL; 
                    if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
                        brightnessRatio = MAX_BRIGHTNESS_RATIO;
                    }
                    const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
                    
                    ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;
                    ctx.drawImage(img, tile.x, tile.y, tile.width, tile.height);
                    ctx.filter = 'none';

                    loadedCount++;
                    progressBar.style.width = `${Math.round(loadedCount / totalTiles * 100)}%`;
                    resolve();
                };
                img.onerror = () => {
                    console.error(`タイル画像のロードに失敗: ${tile.url}`);
                    const grayValue = Math.round(tile.targetL * 2.55); 
                    ctx.fillStyle = `rgb(${grayValue}, ${grayValue}, ${grayValue})`; 
                    ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
                    loadedCount++;
                    progressBar.style.width = `${Math.round(loadedCount / totalTiles * 100)}%`;
                    resolve(); 
                };
                img.src = tile.url; 
            });
            promises.push(p);
        }

        await Promise.all(promises);

        if (blendOpacity > 0) {
            ctx.globalCompositeOperation = 'multiply'; 
            ctx.globalAlpha = blendOpacity / 100;
            ctx.drawImage(mainImage, 0, 0, width, height);
            ctx.globalCompositeOperation = 'source-over'; 
            ctx.globalAlpha = 1.0; 
        }

        statusText.textContent = 'ステータス: モザイクアートが完成しました！';
        generateButton.disabled = false;
        downloadButton.style.display = 'block';
        progressBar.style.width = '100%';
    }

    // --- 5. ダウンロード機能 (PNG形式) --- (変更なし)
    downloadButton.addEventListener('click', () => {
        const dataURL = mainCanvas.toDataURL('image/png'); 
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `photomosaic-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
});
