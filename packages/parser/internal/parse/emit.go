package parse

import "dota2-collector/parser/internal/model"

const flushBatch = 8192

// Sink receives high-volume rows during decode so extract RAM stays
// O(batch). Small tables stay on Result until Finish.
type Sink interface {
	FlushCombat([]model.CombatLog) error
	FlushIntervals([]model.Interval) error
	FlushActions([]model.Action) error
	Finish(*model.Result) error
}

func (s *Session) addCombat(row model.CombatLog) error {
	s.out.CombatLog = append(s.out.CombatLog, row)
	if s.sink == nil || len(s.out.CombatLog) < flushBatch {
		return nil
	}
	if err := s.sink.FlushCombat(s.out.CombatLog); err != nil {
		return err
	}
	s.out.CombatLog = s.out.CombatLog[:0]
	return nil
}

func (s *Session) addInterval(row model.Interval) error {
	s.out.Intervals = append(s.out.Intervals, row)
	if s.sink == nil || len(s.out.Intervals) < flushBatch {
		return nil
	}
	if err := s.sink.FlushIntervals(s.out.Intervals); err != nil {
		return err
	}
	s.out.Intervals = s.out.Intervals[:0]
	return nil
}

func (s *Session) addAction(row model.Action) error {
	s.out.Actions = append(s.out.Actions, row)
	if s.sink == nil || len(s.out.Actions) < flushBatch {
		return nil
	}
	if err := s.sink.FlushActions(s.out.Actions); err != nil {
		return err
	}
	s.out.Actions = s.out.Actions[:0]
	return nil
}
