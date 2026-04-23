import base64
import time
import uuid

import dashscope
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from core.config import API_KEY
from models.database import SessionLocal, VisionLog, init_db
from routers.navigation import router as navigation_router

app = FastAPI(title='HuiVision 慧视后端', version='1.2.0')

init_db()
dashscope.api_key = API_KEY
app.include_router(navigation_router)


@app.post('/v1/vision/analyze')
async def analyze_scene(file: UploadFile = File(...)):
    request_id = str(uuid.uuid4())
    start_time = time.time()

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail='图片上传失败')
    base64_image = base64.b64encode(content).decode('utf-8')

    async def event_generator():
        full_content = ''
        first_token_time = None
        responses = dashscope.MultiModalConversation.call(
            model='qwen-vl-plus',
            messages=[{'role': 'user', 'content': [
                {'image': f'data:image/jpeg;base64,{base64_image}'},
                {'text': '你是一位视障人士向导。请简洁描述正前方2米内的障碍物及方位。'}
            ]}],
            stream=True,
        )

        for response in responses:
            if response.status_code == 200:
                current_full_text = response.output.choices[0].message.content[0]['text']
                new_content = current_full_text[len(full_content):]
                full_content = current_full_text
                if not first_token_time and new_content:
                    first_token_time = time.time()
                if new_content:
                    yield new_content
            else:
                yield f'Error: {response.message}'

        end_time = time.time()
        first_latency = (first_token_time - start_time) * 1000 if first_token_time else 0
        total_latency = (end_time - start_time) * 1000

        db = SessionLocal()
        try:
            log_entry = VisionLog(
                request_id=request_id,
                image_path=file.filename,
                ai_result=full_content,
                first_token_latency=first_latency,
                total_latency=total_latency,
            )
            db.add(log_entry)
            db.commit()
        except Exception as e:
            print(f'数据库写入失败: {e}')
        finally:
            db.close()

    return StreamingResponse(event_generator(), media_type='text/event-stream')


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host='0.0.0.0', port=8000)
