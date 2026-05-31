import express from 'express'
import cors from 'cors'
import deployRouter from './routes/deploy.js'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors())
app.use(express.json())
app.use('/api', deployRouter)

app.listen(PORT, () => {
  console.log(`DeployMate backend running on http://localhost:${PORT}`)
})
