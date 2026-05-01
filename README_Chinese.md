编译前端生成新的前端html：
cd frontend
npm run build

运行程序需要开两个terminal窗口：
1）后端：Run the FastAPI service:
在根目录下执行：
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload

2）前端， cd 到frontend目录下运行
   npm run dev