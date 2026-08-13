import { authMiddleware } from '../../../auth.js'

async function requireAgent(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  try {
    if (req.user.role !== 'agent') {
      return res.status(403).json({ error: 'Forbidden: inspector required' })
    }
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

export function registerInspectorRoutes(
  app,
  { inspectorService, areaService, dimensionService, config, logger }
) {
  app.get('/api/inspector/assignments', authMiddleware, requireAgent, async (req, res) => {
    try {
      const items = await inspectorService.listAssignments({
        agentId: req.user.id,
        status: req.query.status,
      })
      res.json({ items })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list inspector assignments')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/inspector/assignments/:id', authMiddleware, requireAgent, async (req, res) => {
    try {
      const assignment = await inspectorService.getAssignmentById(req.params.id)
      if (!assignment || assignment.agent_id !== req.user.id) {
        return res.status(404).json({ error: 'Assignment not found' })
      }
      const area = await areaService.getById(assignment.area_id)
      const dimensions = await dimensionService.list({ isActive: true })
      res.json({ assignment, area, dimensions })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to get inspector assignment')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/inspector/assignments/:id/start', authMiddleware, requireAgent, async (req, res) => {
    try {
      const assignment = await inspectorService.getAssignmentById(req.params.id)
      if (!assignment || assignment.agent_id !== req.user.id) {
        return res.status(404).json({ error: 'Assignment not found' })
      }
      const updated = await inspectorService.updateAssignmentStatus(req.params.id, 'in_progress')
      res.json(updated)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to start assignment')
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/inspector/submissions', authMiddleware, requireAgent, async (req, res) => {
    try {
      const items = await inspectorService.listSubmissions({
        agentId: req.user.id,
        areaId: req.query.areaId,
        status: req.query.status,
      })
      res.json({ items })
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to list submissions')
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/inspector/submissions', authMiddleware, requireAgent, async (req, res) => {
    try {
      const body = req.body
      const assignment = body.assignment_id
        ? await inspectorService.getAssignmentById(body.assignment_id)
        : null
      if (assignment && assignment.agent_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden: assignment not owned by you' })
      }
      const submission = await inspectorService.createSubmission({
        ...body,
        agent_id: req.user.id,
      })
      if (assignment) {
        await inspectorService.updateAssignmentStatus(assignment.id, 'completed')
      }
      res.status(201).json(submission)
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to create submission')
      res.status(500).json({ error: err.message })
    }
  })
}
