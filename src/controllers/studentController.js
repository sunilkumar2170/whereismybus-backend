const prisma = require('../db');

const getStudents = async (req, res) => {
  try {
    const students = await prisma.student.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, students });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const addStudent = async (req, res) => {
  try {
    const { name, admissionNo, busId, parentPhone, class: className, stopId } = req.body;
    if (!name || !busId || !parentPhone)
      return res.status(400).json({ message: 'Name, busId and parentPhone required' });
    const student = await prisma.student.create({
      data: { name, admissionNo: admissionNo||'', busId, parentPhone, class: className||'', stopId: stopId||null },
    });
    res.json({ success: true, student });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const deleteStudent = async (req, res) => {
  try {
    await prisma.student.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getStudentsByBus = async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      where: { busId: req.params.busId }, orderBy: { name: 'asc' },
    });
    res.json({ success: true, students });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = { getStudents, addStudent, deleteStudent, getStudentsByBus };
