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
    
    // ★ 変更点: ヒストグラムスライダーの要素を取得
    const histogramWeightInput = document.getElementById('histogram-weight');
    const histogramWeightValue = document.getElementById('histogram-weight-value');

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

    // ★ 変更点: ヒストグラムスライダーの値表示を更新
    if (histogramWeightInput && histogramWeightValue) {
        histogramWeightInput.addEventListener('input', () => {
            histogramWeightValue.textContent = histogramWeightInput.value;
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
        
        // ★ 変更点: JSONにヒストグラムデータがあるか簡易チェック
        if (tileData.length > 0 && !tileData[0].histogram) {
             throw new Error('tile_data.jsonが古いようです。Analyzer Appでヒストグラム情報を含む新しいデータを再生成してください。');
        }
        
        statusText.textContent = `ステータス: タイルデータ (${tileData.length}枚分) ロード完了。メイン画像を選択してください。`;
        if (mainImageInput) mainImageInput.disabled = false;
    } catch (error) {
        statusText.textContent = `エラー: ${error.message}`;
        console.error("Initialization Error:", error);
        return;
    }
    
    // --- 2. メイン画像アップロード ---
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

                    // Canvasのサイズをメイン画像に合わせる
                    mainCanvas.width = mainImage.width;
                    mainCanvas.height = mainImage.height;
                    
                    ctx.clearRect(0, 0, mainImage.width, mainImage.height);
                    ctx.drawImage(mainImage, 0, 0); // プレビュー表示
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

        // メイン画像のピクセルデータを取得
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = mainImage.width;
        tempCanvas.height = mainImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(mainImage, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, mainImage.width, mainImage.height);

        // Workerを起動 (互換性維持のため mosaic_worker.js を参照)
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
            // ★ 変更点: ヒストグラムの重みを渡す
            histogramWeight: parseFloat(histogramWeightInput.value) 
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

    // --- 4. 最終的なモザイクの描画 ---
    // (renderMosaic 関数は変更ありません)
    async function renderMosaic(results, width, height, blendOpacity, brightnessCompensation) {
        statusText.textContent = 'ステータス: タイル画像を読み込み、描画中...';
        mainCanvas.width = width;
        mainCanvas.height = height;
        ctx.clearRect(0, 0, width, height);

        let loadedCount = 0;
        const totalTiles = results.length;
        const promises = [];
        
        // --- 明度補正のための安全装置設定 ---
        const MIN_TILE_L = 5.0; // タイルのL*値がこの値未満の場合、明度補正を制限 (0-100)
        const MAX_BRIGHTNESS_RATIO = 5.0; // 最大補正倍率を500%に制限
        const brightnessFactor = brightnessCompensation / 100; // 補正の適用度 (0.0 to 1.0)

        // 描画に必要なタイル画像を非同期でロードし、描画する
        for (const tile of results) {
            const p = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    // --- 明度補正の計算 ---
                    let targetL = tile.targetL; // ブロックのL*値
                    let tileL = tile.tileL; // タイル画像のL*値

                    // L*値を0-100の範囲で扱うため、最小値を強制
                    if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 

                    // 必要な明るさの倍率を計算 (目標L* / タイルL*)
                    let brightnessRatio = targetL / tileL; 

                    // 補正倍率にクランプ処理 (最大補正倍率の制限)
                    if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
                        brightnessRatio = MAX_BRIGHTNESS_RATIO;
                    }

                    // 最終的なフィルター値 (元の明るさに対する補正倍率)
                    // 補正係数を考慮: 補正が100% (factor=1)なら完全に一致、0%なら補正なし
                    const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
                    
                    // --- 描画 ---
                    // Canvas filterプロパティで明度補正を適用
                    ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;

                    // 高解像度タイルを縮小して描画
                    ctx.drawImage(img, tile.x, tile.y, tile.width, tile.height);
                    
                    // フィルターをリセット (次のタイルに影響を与えないように)
                    ctx.filter = 'none';

                    loadedCount++;
                    // ロード進捗を更新
                    progressBar.style.width = `${Math.round(loadedCount / totalTiles * 100)}%`;
                    resolve();
                };
                img.onerror = () => {
                    // 画像ロード失敗時: エラーログを出し、灰色で埋める
                    console.error(`タイル画像のロードに失敗: ${tile.url}`);
                    // ターゲットL*からRGBに変換し、失敗ブロックを埋める
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

        // すべてのタイルが描画された後、ブレンド処理
        await Promise.all(promises);

        // --- ブレンド処理 ---
        if (blendOpacity > 0) {
            // ブレンドモード: Multiply (陰影を強調)
            ctx.globalCompositeOperation = 'multiply'; 
            ctx.globalAlpha = blendOpacity / 100;

            // 元画像をフルサイズで描画
            ctx.drawImage(mainImage, 0, 0, width, height);

            // 元に戻す
            ctx.globalCompositeOperation = 'source-over'; 
            ctx.globalAlpha = 1.0; 
        }

        statusText.textContent = 'ステータス: モザイクアートが完成しました！';
        generateButton.disabled = false;
        downloadButton.style.display = 'block';
        progressBar.style.width = '100%';
    }

    // --- 5. ダウンロード機能 (PNG形式) ---
    downloadButton.addEventListener('click', () => {
        // PNG形式 (ロスレス) でダウンロード
        const dataURL = mainCanvas.toDataURL('image/png'); 
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `photomosaic-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
});
