document.addEventListener('DOMContentLoaded', async () => {
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const ctx = mainCanvas.getContext('2d');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const blendValueSpan = document.getElementById('blend-value'); // 追加

    let tileData = null;
    let mainImage = null;

    // --- UIイベント: ブレンド度スライダーのリアルタイム表示 ---
    blendRangeInput.addEventListener('input', () => {
        blendValueSpan.textContent = blendRangeInput.value;
    });

    // --- 1. タイルデータの初期ロード ---
    try {
        const response = await fetch('tile_data.json');
        if (!response.ok) {
            throw new Error('tile_data.json のロードに失敗しました。');
        }
        tileData = await response.json();
        statusText.textContent = `ステータス: タイルデータ (${tileData.length}枚分) ロード完了。メイン画像を選択してください。`;
    } catch (error) {
        statusText.textContent = `エラー: ${error.message}。JSONファイルを確認してください。`;
        return;
    }
    
    // --- 2. メイン画像アップロード ---
    mainImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            mainImage = new Image();
            mainImage.onload = () => {
                generateButton.disabled = false;
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

    // --- 3. モザイク生成開始 ---
    generateButton.addEventListener('click', () => {
        if (!mainImage) return;
        
        generateButton.disabled = true;
        downloadButton.style.display = 'none';
        progressBar.style.width = '0%';
        statusText.textContent = 'ステータス: マッチング処理の準備中...';

        // メイン画像のピクセルデータを取得
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = mainImage.width;
        tempCanvas.height = mainImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(mainImage, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, mainImage.width, mainImage.height);

        // Workerを起動
        const worker = new Worker('mosaic_worker.js');

        // Workerにデータを送信 
        worker.postMessage({ 
            imageData: imageData, 
            tileData: tileData, 
            tileSize: parseInt(tileSizeInput.value),
            width: mainImage.width,
            height: mainImage.height,
            blendOpacity: parseInt(blendRangeInput.value) / 100 
        });

        // Workerからのメッセージ受信
        worker.onmessage = (e) => {
            if (e.data.type === 'status') {
                statusText.textContent = `ステータス: ${e.data.message}`;
            } else if (e.data.type === 'progress') {
                // マッチング進捗
                const progress = Math.round(e.data.progress * 100);
                progressBar.style.width = `${progress}%`;
            } else if (e.data.type === 'complete') {
                // マッチング完了後、高解像度描画プロセスへ
                renderMosaic(e.data.results, e.data.width, e.data.height, e.data.blendOpacity);
                worker.terminate();
            }
        };

        worker.onerror = (error) => {
            statusText.textContent = `エラー: Worker処理中に問題が発生しました。 ${error.message}`;
            generateButton.disabled = false;
            worker.terminate();
        };
    });

    // --- 4. 最終的なモザイクの高解像度描画 ---
    function renderMosaic(results, width, height, blendOpacity) {
        statusText.textContent = 'ステータス: タイル画像をロードし、高解像度で描画中...';
        mainCanvas.width = width;
        mainCanvas.height = height;
        ctx.clearRect(0, 0, width, height);

        let loadedCount = 0;
        const totalTiles = results.length;
        
        // 描画に必要なタイル画像を非同期でロードし、描画する
        const renderPromises = results.map(tile => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous'; 
                img.onload = () => {
                    // 【★修正箇所★】タイル画像が縦横比を維持して、割り当てられたブロックの中央に描画されるように変更
                    
                    // 割り当てられたブロックの幅と高さ
                    const blockWidth = tile.width;
                    const blockHeight = tile.height;

                    // タイル画像の元の縦横比とブロックサイズを比較し、縮小率を決定
                    const ratio = Math.min(blockWidth / img.width, blockHeight / img.height);
                    
                    // 歪みが生じない新しい描画サイズを計算
                    const drawWidth = img.width * ratio;
                    const drawHeight = img.height * ratio;

                    // ブロックの中央に配置するためのオフセットを計算
                    const offsetX = tile.x + (blockWidth - drawWidth) / 2;
                    const offsetY = tile.y + (blockHeight - drawHeight) / 2;

                    // 元の縦横比を保って描画
                    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
                    
                    loadedCount++;
                    
                    // ロード進捗を更新
                    progressBar.style.width = `${Math.round(loadedCount / totalTiles * 100)}%`;
                    
                    resolve();
                };
                img.onerror = () => {
                    console.error(`タイル画像のロードに失敗: ${tile.url}`);
                    // ロード失敗時も進捗を進める
                    loadedCount++;
                    progressBar.style.width = `${Math.round(loadedCount / totalTiles * 100)}%`;
                    resolve(); 
                };
                img.src = tile.url; 
            });
        });

        // すべてのタイルが描画された後、ブレンド処理
        Promise.all(renderPromises).then(() => {
            // ブレンド処理 (元の画像を半透明で重ねる)
            applyBlend(width, height, blendOpacity);
            
            statusText.textContent = 'ステータス: モザイクアートが完成しました！';
            generateButton.disabled = false;
            downloadButton.style.display = 'block';
            progressBar.style.width = '100%';
        });
    }

    // --- ブレンド処理の関数化 ---
    function applyBlend(width, height, opacity) {
        if (opacity > 0 && mainImage) {
            ctx.globalAlpha = opacity;
            ctx.drawImage(mainImage, 0, 0, width, height);
            ctx.globalAlpha = 1.0; // 元に戻す
        }
    }

    // --- 5. ダウンロード機能 ---
    downloadButton.addEventListener('click', () => {
        const dataURL = mainCanvas.toDataURL('image/jpeg', 0.9); 
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `photomosaic-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
});
